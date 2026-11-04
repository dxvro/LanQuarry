import { and, eq, inArray } from 'drizzle-orm';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { Db } from '../db/client.js';
import { modDependencies, mods, servers, type Mod, type ModUpdateLogEntry, type Server } from '../db/schema.js';
import { AppError } from '../http/errors.js';
import type { Category, ModrinthApi, SearchHit, SearchIndex } from '../modrinth/types.js';
import { defaultDownloaderOptions, type DownloaderOptions } from './downloader.js';
import { rethrowFsError, type ModLogger } from './fs-errors.js';
import { installPlan } from './installer.js';
import { KeyedLock } from '../lib/keyed-lock.js';
import { requireLoaderProfile, type LoaderProfile } from './profile.js';
import { planInstall } from './resolver.js';
import { assertNotRunning, type ServerRuntimeGuard } from './runtime-guard.js';
import { scanServer, type ScanReport } from './scanner.js';
import {
  applyUpdates,
  checkUpdates,
  listUpdateLog,
  loadResolverContext,
  type UpdateCandidate,
  type UpdateEnv,
  type UpdateResult,
} from './updater.js';

export interface ModServiceOptions {
  db: Db;
  modrinth: ModrinthApi;
  guard: ServerRuntimeGuard;
  serversDir: string;
  downloader?: DownloaderOptions;
  logger?: ModLogger;
  lock?: KeyedLock;
}

export interface SearchQuery {
  query: string;
  categories: string[];
  limit: number;
  offset: number;
  index: SearchIndex;
}

export interface SearchResponse {
  hits: Array<{
    projectId: string;
    slug: string;
    title: string;
    description: string;
    author: string;
    categories: string[];
    downloads: number;
    follows: number;
    iconUrl: string | null;
    serverSide: string | null;
    installed: boolean;
  }>;
  totalHits: number;
  offset: number;
  limit: number;
}

export interface RemoveResult {
  removed: Mod;
  orphaned: Mod[];
}

interface Context {
  server: Server;
  profile: LoaderProfile;
  env: UpdateEnv;
}

export class ModService {
  private readonly lock: KeyedLock;
  private readonly downloader: DownloaderOptions;

  constructor(private readonly options: ModServiceOptions) {
    this.downloader = options.downloader ?? defaultDownloaderOptions();
    this.lock = options.lock ?? new KeyedLock();
  }

  private async context(serverId: string): Promise<Context> {
    const server = (await this.options.db.select().from(servers).where(eq(servers.id, serverId)))[0];
    if (server === undefined) throw new AppError(404, 'SERVER_NOT_FOUND', 'Der Server wurde nicht gefunden.');
    const profile = requireLoaderProfile(server.loader);
    return {
      server,
      profile,
      env: {
        db: this.options.db,
        modrinth: this.options.modrinth,
        profile,
        serverDir: path.join(this.options.serversDir, server.id),
        serverId: server.id,
        downloader: this.downloader,
        mcVersion: server.mcVersion,
        ...(this.options.logger === undefined ? {} : { logger: this.options.logger }),
      },
    };
  }

  async list(serverId: string): Promise<Mod[]> {
    await this.context(serverId);
    return this.options.db.select().from(mods).where(eq(mods.serverId, serverId)).orderBy(mods.name);
  }

  async categories(): Promise<Category[]> {
    return this.options.modrinth.categories();
  }

  async search(serverId: string, query: SearchQuery): Promise<SearchResponse> {
    const { server, profile } = await this.context(serverId);
    // hard filters first; user categories can only add further AND groups
    const facets: string[][] = [
      [`project_type:${profile.projectType}`],
      [`versions:${server.mcVersion}`],
      profile.loaders.map((loader) => `categories:${loader}`),
      ['server_side:required', 'server_side:optional'],
      ...query.categories.map((category) => [`categories:${category}`]),
    ];
    const result = await this.options.modrinth.search({
      query: query.query,
      facets,
      index: query.index,
      limit: query.limit,
      offset: query.offset,
    });
    const installed = new Set(
      (await this.options.db.select({ projectId: mods.projectId }).from(mods).where(eq(mods.serverId, serverId))).map(
        (row) => row.projectId,
      ),
    );
    const toHit = (hit: SearchHit): SearchResponse['hits'][number] => ({
      projectId: hit.project_id,
      slug: hit.slug,
      title: hit.title,
      description: hit.description,
      author: hit.author,
      categories: hit.categories,
      downloads: hit.downloads,
      follows: hit.follows,
      iconUrl: hit.icon_url ?? null,
      serverSide: hit.server_side ?? null,
      installed: installed.has(hit.project_id),
    });
    return { hits: result.hits.map(toHit), totalHits: result.total_hits, offset: result.offset, limit: result.limit };
  }

  scan(serverId: string): Promise<ScanReport> {
    return this.locked(serverId, false, async ({ env }) => scanServer(env));
  }

  install(serverId: string, projectId: string, versionId?: string): Promise<{ installed: Mod[]; warnings: string[] }> {
    return this.locked(serverId, true, async ({ env }) => {
      await scanServer(env);
      const decision = await planInstall(await loadResolverContext(env), projectId, versionId);
      if (decision.kind === 'flip') {
        await env.db.transaction((tx) =>
          tx.update(mods).set({ isDependency: false, updatedAt: new Date() }).where(eq(mods.id, decision.mod.id)),
        );
        return { installed: [{ ...decision.mod, isDependency: false }], warnings: [] };
      }
      const installed = await installPlan(env, decision.plan);
      return { installed, warnings: decision.plan.warnings };
    });
  }

  remove(serverId: string, modId: string, force: boolean): Promise<RemoveResult> {
    return this.locked(serverId, true, async ({ env }) => {
      const { db } = env;
      const mod = (await db.select().from(mods).where(and(eq(mods.id, modId), eq(mods.serverId, serverId))))[0];
      if (mod === undefined) throw new AppError(404, 'MOD_NOT_FOUND', 'Der Mod wurde nicht gefunden.');

      const dependents = await this.dependentsOf(db, mod.id);
      if (dependents.length > 0 && !force) {
        throw new AppError(
          409,
          'MOD_REQUIRED_BY_OTHERS',
          `„${mod.name}“ wird von anderen Mods benötigt: ${dependents.map((d) => d.name).join(', ')}.`,
          { dependents: dependents.map((d) => ({ id: d.id, name: d.name })) },
        );
      }
      const required = await db
        .select({ target: modDependencies.dependsOnModId })
        .from(modDependencies)
        .where(and(eq(modDependencies.modId, mod.id), eq(modDependencies.dependencyType, 'required')));
      const targetIds = required.map((row) => row.target).filter((id): id is string => id !== null);

      try {
        await rm(path.join(env.serverDir, env.profile.contentDir, mod.fileName), { force: true });
      } catch (error) {
        this.options.logger?.error({ err: error, modId: mod.id, fileName: mod.fileName }, 'Mod-Datei konnte nicht gelöscht werden');
        rethrowFsError(error, mod.fileName);
      }
      await db.transaction((tx) => tx.delete(mods).where(eq(mods.id, mod.id)));

      const orphaned: Mod[] = [];
      if (targetIds.length > 0) {
        const candidates = await db
          .select()
          .from(mods)
          .where(and(inArray(mods.id, targetIds), eq(mods.isDependency, true)));
        for (const candidate of candidates) {
          if ((await this.dependentsOf(db, candidate.id)).length === 0) orphaned.push(candidate);
        }
      }
      return { removed: mod, orphaned };
    });
  }

  private async dependentsOf(db: Db, modId: string): Promise<Mod[]> {
    const rows = await db
      .select({ modId: modDependencies.modId })
      .from(modDependencies)
      .where(and(eq(modDependencies.dependsOnModId, modId), eq(modDependencies.dependencyType, 'required')));
    const ids = [...new Set(rows.map((row) => row.modId))].filter((id) => id !== modId);
    return ids.length === 0 ? [] : db.select().from(mods).where(inArray(mods.id, ids));
  }

  checkUpdates(serverId: string): Promise<{ updates: UpdateCandidate[]; scan: ScanReport }> {
    return this.locked(serverId, false, async ({ env }) => {
      const scan = await scanServer(env);
      return { updates: await checkUpdates(env), scan };
    });
  }

  applyUpdates(serverId: string, projectIds?: string[]): Promise<{ results: UpdateResult[] }> {
    return this.locked(serverId, true, async ({ env }) => {
      await scanServer(env);
      return { results: await applyUpdates(env, projectIds) };
    });
  }

  async updateLog(serverId: string, limit: number): Promise<ModUpdateLogEntry[]> {
    const { env } = await this.context(serverId);
    return listUpdateLog(env, limit);
  }

  private async locked<T>(serverId: string, mutating: boolean, task: (context: Context) => Promise<T>): Promise<T> {
    const context = await this.context(serverId);
    if (mutating) assertNotRunning(this.options.guard, serverId);
    return this.lock.run(serverId, () => {
      if (mutating) assertNotRunning(this.options.guard, serverId);
      return task(context);
    });
  }
}
