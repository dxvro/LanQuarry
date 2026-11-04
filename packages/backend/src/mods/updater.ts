import { desc, eq } from 'drizzle-orm';
import { access, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import type { UpdateStatus } from '../db/enums.js';
import { modDependencies, modUpdateLog, mods, type Mod } from '../db/schema.js';
import { AppError } from '../http/errors.js';
import type { ModrinthApi, Version } from '../modrinth/types.js';
import { removeQuietly } from './files.js';
import { lockedFileError, type ModLogger } from './fs-errors.js';
import {
  assertDestinationsFree,
  contentDirOf,
  downloadItems,
  insertDependencyRows,
  insertPlannedMods,
  placeItems,
  projectModMap,
  type InstallEnv,
} from './installer.js';
import { planUpdate, type InstalledIncompatibility, type ResolverContext } from './resolver.js';
import { relinkDependencies } from './scanner.js';
import { chooseNewestByDate, isCompatible, pickFile, publishedAt, stabilityRank } from './versions.js';

export interface UpdateEnv extends InstallEnv {
  modrinth: ModrinthApi;
  mcVersion: string;
  logger?: ModLogger;
}

export interface UpdateCandidate {
  modId: string;
  projectId: string;
  name: string;
  currentVersionId: string;
  currentVersionNumber: string;
  newVersionId: string;
  newVersionNumber: string;
  versionType: Version['version_type'];
  newFileName: string;
}

export interface UpdateResult {
  modId: string;
  name: string;
  status: UpdateStatus;
  error?: string;
}

interface InternalCandidate {
  info: UpdateCandidate;
  version: Version;
}

export async function loadResolverContext(env: UpdateEnv): Promise<ResolverContext> {
  const installed = await env.db.select().from(mods).where(eq(mods.serverId, env.serverId));
  const rows = await env.db
    .select({ modId: modDependencies.modId, projectId: modDependencies.projectId })
    .from(modDependencies)
    .where(eq(modDependencies.dependencyType, 'incompatible'));
  const byId = new Map(installed.map((mod) => [mod.id, mod]));
  const installedIncompatibilities: InstalledIncompatibility[] = [];
  for (const row of rows) {
    const owner = byId.get(row.modId);
    if (owner !== undefined && row.projectId !== null) {
      installedIncompatibilities.push({ modId: owner.id, modName: owner.name, projectId: row.projectId });
    }
  }
  return {
    modrinth: env.modrinth,
    profile: env.profile,
    mcVersion: env.mcVersion,
    installed,
    installedIncompatibilities,
  };
}

async function findCandidates(env: UpdateEnv): Promise<InternalCandidate[]> {
  const rows = (await env.db.select().from(mods).where(eq(mods.serverId, env.serverId))).filter(
    (row): row is Mod & { projectId: string } => row.projectId !== null,
  );
  if (rows.length === 0) return [];
  const hashes = rows.map((row) => row.sha512);
  const current = await env.modrinth.versionFilesByHash(hashes);
  const proposed = await env.modrinth.versionFilesUpdate(hashes, env.profile.loaders, [env.mcVersion]);

  const out: InternalCandidate[] = [];
  for (const row of rows) {
    const cur = current[row.sha512];
    if (cur === undefined) continue;
    const minRank = stabilityRank(cur.version_type);
    let best: Version | null = proposed[row.sha512] ?? null;
    if (best !== null && (stabilityRank(best.version_type) < minRank || !isCompatible(best, env.profile, env.mcVersion))) {
      best = null;
      const versions = await env.modrinth.listProjectVersions(row.projectId, env.profile.loaders, [env.mcVersion]);
      best = chooseNewestByDate(versions, env.profile, env.mcVersion, minRank);
    }
    if (best === null || best.id === cur.id || publishedAt(best) < publishedAt(cur)) continue;
    const file = pickFile(best);
    out.push({
      version: best,
      info: {
        modId: row.id,
        projectId: row.projectId,
        name: row.name,
        currentVersionId: cur.id,
        currentVersionNumber: cur.version_number,
        newVersionId: best.id,
        newVersionNumber: best.version_number,
        versionType: best.version_type,
        newFileName: file?.filename ?? '',
      },
    });
  }
  return out;
}

export async function checkUpdates(env: UpdateEnv): Promise<UpdateCandidate[]> {
  return (await findCandidates(env)).map((candidate) => candidate.info);
}

async function writeLog(
  env: UpdateEnv,
  candidate: UpdateCandidate,
  mod: Mod,
  status: UpdateStatus,
  extra: { backupPath?: string | null; error?: string | null; toFileName?: string },
): Promise<void> {
  await env.db.transaction((tx) => tx.insert(modUpdateLog).values(logValues(env, candidate, mod, status, extra)));
}

function logValues(
  env: UpdateEnv,
  candidate: UpdateCandidate,
  mod: Mod,
  status: UpdateStatus,
  extra: { backupPath?: string | null; error?: string | null; toFileName?: string },
): typeof modUpdateLog.$inferInsert {
  return {
    serverId: env.serverId,
    modId: mod.id,
    modName: mod.name,
    fromVersionId: mod.versionId,
    toVersionId: candidate.newVersionId,
    fromFileName: mod.fileName,
    toFileName: extra.toFileName ?? candidate.newFileName,
    backupPath: extra.backupPath ?? null,
    status,
    error: extra.error ?? null,
    createdAt: new Date(),
  };
}

function errorText(env: UpdateEnv, mod: Mod, error: unknown): string {
  if (error instanceof AppError) return error.message;
  env.logger?.error({ err: error, modId: mod.id, fileName: mod.fileName }, 'Update fehlgeschlagen');
  return lockedFileError(error, mod.fileName)?.message ?? 'Unerwarteter Fehler beim Aktualisieren.';
}

function backupName(fileName: string, taken: boolean): string {
  if (!taken) return fileName;
  const stamp = new Date().toISOString().replace(/\D/g, '');
  return fileName.replace(/\.jar$/i, '') + `-${stamp}.jar`;
}

async function applyOne(env: UpdateEnv, candidate: InternalCandidate): Promise<UpdateResult> {
  const info = candidate.info;
  const mod = (await env.db.select().from(mods).where(eq(mods.id, info.modId)))[0];
  if (mod === undefined) return { modId: info.modId, name: info.name, status: 'failed', error: 'Mod nicht mehr vorhanden.' };

  let tmp = new Map<string, string>();
  const placed: string[] = [];
  let backupFull: string | null = null;
  let oldMoved = false;
  const oldPath = path.join(contentDirOf(env), mod.fileName);
  const backupDirPath = path.join(env.serverDir, env.profile.backupDir);

  try {
    const plan = await planUpdate(await loadResolverContext(env), mod, candidate.version);
    const root = plan.items.find((item) => item.projectId === mod.projectId);
    if (root === undefined) throw new Error('Interner Fehler: Wurzel fehlt im Plan.');
    await assertDestinationsFree(env, plan.items, mod.fileName);
    tmp = await downloadItems(env, plan.items);

    try {
      await mkdir(backupDirPath, { recursive: true });
      const taken = await access(path.join(backupDirPath, mod.fileName)).then(
        () => true,
        () => false,
      );
      backupFull = path.join(backupDirPath, backupName(mod.fileName, taken));
      await rename(oldPath, backupFull);
      oldMoved = true;
      await placeItems(env, plan.items, tmp, placed);
      const backupRelative = path.join(env.profile.backupDir, path.basename(backupFull)).replaceAll('\\', '/');
      await env.db.transaction(async (tx) => {
        const projectToMod = await projectModMap(tx, env.serverId);
        const rootFile = root.file;
        await tx
          .update(mods)
          .set({
            versionId: root.version.id,
            versionNumber: root.version.version_number,
            fileName: rootFile.filename,
            sha512: (rootFile.hashes.sha512 ?? '').toLowerCase(),
            sizeBytes: rootFile.size,
            updatedAt: new Date(),
          })
          .where(eq(mods.id, mod.id));
        await tx.delete(modDependencies).where(eq(modDependencies.modId, mod.id));
        const extras = plan.items.filter((item) => item !== root);
        for (const row of await insertPlannedMods(tx, env.serverId, extras, plan.names, projectToMod)) {
          if (row.projectId !== null) projectToMod.set(row.projectId, row.id);
        }
        await insertDependencyRows(tx, mod.id, root, projectToMod);
        await relinkDependencies(tx, env.serverId);
        await tx.insert(modUpdateLog).values(logValues(env, info, mod, 'success', { backupPath: backupRelative, toFileName: rootFile.filename }));
      });
      return { modId: mod.id, name: mod.name, status: 'success' };
    } catch (error) {
      await removeQuietly(...placed);
      let restoreNote = '';
      if (oldMoved && backupFull !== null) {
        try {
          await rename(backupFull, oldPath);
        } catch {
          restoreNote = ` Die Originaldatei liegt weiterhin im Backup-Ordner (${path.basename(backupFull)}).`;
        }
      }
      const message = errorText(env, mod, error) + restoreNote;
      const status: UpdateStatus = oldMoved ? 'rolled_back' : 'failed';
      await writeLog(env, info, mod, status, { error: message, backupPath: null });
      return { modId: mod.id, name: mod.name, status, error: message };
    }
  } catch (error) {
    const message = errorText(env, mod, error);
    await writeLog(env, info, mod, 'failed', { error: message });
    return { modId: mod.id, name: mod.name, status: 'failed', error: message };
  } finally {
    await removeQuietly(...tmp.values());
  }
}

export async function applyUpdates(env: UpdateEnv, projectIds?: readonly string[]): Promise<UpdateResult[]> {
  const candidates = (await findCandidates(env)).filter(
    (candidate) => projectIds === undefined || projectIds.includes(candidate.info.projectId),
  );
  const results: UpdateResult[] = [];
  for (const candidate of candidates) results.push(await applyOne(env, candidate));
  return results;
}

export function listUpdateLog(env: Pick<UpdateEnv, 'db' | 'serverId'>, limit: number): Promise<Array<typeof modUpdateLog.$inferSelect>> {
  return env.db
    .select()
    .from(modUpdateLog)
    .where(eq(modUpdateLog.serverId, env.serverId))
    .orderBy(desc(modUpdateLog.createdAt), desc(modUpdateLog.id))
    .limit(limit);
}
