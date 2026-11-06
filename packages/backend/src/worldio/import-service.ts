import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { copyFile, cp, mkdir, readdir, rmdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { DEFAULT_LEVEL, readLevelName, worldNames } from '../backups/world.js';
import type { BackupService } from '../backups/service.js';
import type { ServerDto } from '../contract.js';
import type { Db } from '../db/client.js';
import type { Loader } from '../db/enums.js';
import { mods as modsTable, servers, type Server } from '../db/schema.js';
import { AppError } from '../http/errors.js';
import type { LoaderCatalog } from '../installer/catalog.js';
import { assertFreeSpace, freeBytes, type FreeSpaceReader } from '../lib/disk.js';
import type { KeyedLock } from '../lib/keyed-lock.js';
import { silentLogger, type Logger } from '../lib/logger.js';
import { sanitizeJarName } from '../mods/downloader.js';
import { DISABLED_SUFFIX } from '../mods/files.js';
import { getLoaderProfile } from '../mods/profile.js';
import type { ModService } from '../mods/service.js';
import type { ModrinthApi } from '../modrinth/types.js';
import type { ProcessManager } from '../process/manager.js';
import { loadProperties, saveProperties } from '../properties/store.js';
import type { CreateServerInput } from '../servers/schemas.js';
import type { ServerService } from '../servers/service.js';
import { buildAnalysis, gatherFacts, proposeLoader, type FactMod, type ImportFacts } from './analyze.js';
import type { ImportJobDto, ImportNotice, ImportResultDto, ImportReviewDto } from './dto.js';
import { buildOutput, convertSingleplayerPlayer, moveDir, styleForLoader } from './layout.js';
import { evaluateNotices, matchMods, missingMods, missingNotice, type ModSelection, type ReviewTarget } from './review.js';
import { stageArchive, type StageLimits } from './staging.js';
import { swapWorlds } from './swap.js';

const MIB = 1024 * 1024;
const TTL_OPEN_MS = 2 * 60 * 60_000;
const TTL_FINISHED_MS = 15 * 60_000;
const SWEEP_MS = 60_000;
const MAX_OPEN_JOBS = 3;
const MAX_ENTRIES = 1_000_000;
const MAX_RATIO = 200;
const UNPACK_FACTOR = 4;

export interface ImportServiceOptions {
  db: Db;
  serversDir: string;
  tmpDir: string;
  lock: KeyedLock;
  catalog: LoaderCatalog;
  modrinth: ModrinthApi;
  servers: ServerService;
  mods: ModService;
  backups: BackupService;
  manager: ProcessManager;
  logger?: Logger;
  freeSpace?: FreeSpaceReader;
  maxUploadBytes: number;
  now?: () => number;
}

interface Job {
  dto: ImportJobDto;
  dir: string;
  facts: ImportFacts | null;
}

export interface CreateFromImportInput {
  server: Pick<CreateServerInput, 'name' | 'loader' | 'mcVersion'> & Partial<CreateServerInput>;
  importConfig: boolean;
  selection: ModSelection;
  acknowledged: readonly string[];
}

export interface ReplaceInput {
  acknowledged: readonly string[];
}

const notFound = (): AppError => new AppError(404, 'IMPORT_NOT_FOUND', 'Der Import wurde nicht gefunden oder ist abgelaufen. Bitte das Archiv erneut hochladen.');
const normalise = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '');

export class ImportService {
  private readonly jobs = new Map<string, Job>();
  private readonly logger: Logger;
  private readonly freeSpace: FreeSpaceReader;
  private readonly abort = new AbortController();
  private readonly background = new Set<Promise<void>>();
  private sweeper: NodeJS.Timeout | null = null;
  private readonly now: () => number;

  constructor(private readonly options: ImportServiceOptions) {
    this.logger = options.logger ?? silentLogger;
    this.freeSpace = options.freeSpace ?? freeBytes;
    this.now = options.now ?? Date.now;
  }

  get maxUploadBytes(): number {
    return this.options.maxUploadBytes;
  }

  start(): void {
    if (this.sweeper !== null) return;
    this.sweeper = setInterval(() => void this.sweep(), SWEEP_MS);
    this.sweeper.unref();
  }

  async shutdown(timeoutMs = 10_000): Promise<void> {
    this.abort.abort();
    if (this.sweeper !== null) clearInterval(this.sweeper);
    this.sweeper = null;
    await Promise.race([Promise.allSettled([...this.background]), new Promise<void>((resolve) => setTimeout(resolve, timeoutMs).unref())]);
  }

  async idle(): Promise<void> {
    while (this.background.size > 0) await Promise.allSettled([...this.background]);
  }

  // leftovers of imports that were running when the application ended
  async recoverInterrupted(): Promise<void> {
    await rm(this.options.tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => undefined);
    for (const server of await this.options.db.select({ id: servers.id }).from(servers)) {
      const serverDir = path.join(this.options.serversDir, server.id);
      for (const entry of await readdir(serverDir).catch(() => [])) {
        if (entry.startsWith('.import-new-')) await rm(path.join(serverDir, entry), { recursive: true, force: true }).catch(() => undefined);
        else if (entry.startsWith('.import-old-')) {
          this.logger.warn({ serverId: server.id, entry }, 'Ein unterbrochener Welt-Import hat einen Ordner mit den alten Daten hinterlassen. Er wird nicht automatisch gelöscht.');
        }
      }
    }
  }

  private limits(): StageLimits {
    return { maxBytes: this.options.maxUploadBytes * UNPACK_FACTOR, maxEntries: MAX_ENTRIES, maxRatio: MAX_RATIO };
  }

  // ---- bookkeeping ---------------------------------------------------------------------------

  private snapshot(job: Job): ImportJobDto {
    return { ...job.dto };
  }

  private touch(job: Job): void {
    const finished = job.dto.status === 'done' || job.dto.status === 'failed';
    job.dto.expiresAt = this.now() + (finished ? TTL_FINISHED_MS : TTL_OPEN_MS);
  }

  private find(id: string): Job {
    const job = this.jobs.get(id);
    if (job === undefined) throw notFound();
    return job;
  }

  private async sweep(): Promise<void> {
    const now = this.now();
    for (const [id, job] of [...this.jobs]) {
      if (job.dto.status === 'applying' || job.dto.status === 'uploading' || job.dto.status === 'analyzing') continue;
      if (job.dto.expiresAt <= now) await this.drop(id);
    }
  }

  private async drop(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (job === undefined) return;
    this.jobs.delete(id);
    await rm(job.dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => undefined);
  }

  get(id: string): ImportJobDto {
    const job = this.find(id);
    if (job.dto.status === 'staged') this.touch(job);
    return this.snapshot(job);
  }

  async cancel(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (job === undefined) return;
    if (job.dto.status === 'applying' || job.dto.status === 'uploading') {
      throw new AppError(409, 'IMPORT_IN_PROGRESS', 'Der Import läuft gerade und kann nicht abgebrochen werden.');
    }
    await this.drop(id);
  }

  private launch(job: Job, work: () => Promise<void>): void {
    const promise = work()
      .catch(async (error: unknown) => {
        const message = error instanceof AppError ? error.message : 'Der Import ist aus einem unerwarteten Grund fehlgeschlagen.';
        if (error instanceof AppError) this.logger.warn({ importId: job.dto.id, code: error.code }, `Import fehlgeschlagen: ${message}`);
        else this.logger.error({ err: error, importId: job.dto.id }, 'Import fehlgeschlagen');
        // the files go first: a client that sees "failed" can rely on the staging area being gone
        await rm(job.dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => undefined);
        job.dto.status = 'failed';
        job.dto.error = message;
        job.dto.phase = null;
        this.touch(job);
      })
      .finally(() => {
        this.background.delete(promise);
      });
    this.background.add(promise);
  }

  private checkpoint(): void {
    if (this.abort.signal.aborted) throw new AppError(503, 'SHUTTING_DOWN', 'Der Import wurde wegen des Beendens der Anwendung abgebrochen.');
  }

  // ---- upload and analysis -------------------------------------------------------------------

  private async makeRoom(): Promise<void> {
    const open = [...this.jobs.values()].filter((job) => job.dto.status !== 'done' && job.dto.status !== 'failed');
    if (open.length < MAX_OPEN_JOBS) return;
    const staged = open.filter((job) => job.dto.status === 'staged').sort((a, b) => a.dto.createdAt - b.dto.createdAt);
    if (staged[0] === undefined) {
      throw new AppError(409, 'IMPORT_BUSY', 'Es laufen bereits mehrere Importe. Bitte warten, bis einer abgeschlossen ist.');
    }
    await this.drop(staged[0].dto.id);
  }

  async upload(stream: Readable, input: { contentLength: number | null; serverId: string | null }): Promise<ImportJobDto> {
    const max = this.options.maxUploadBytes;
    const maxText = `${Math.floor(max / MIB).toLocaleString('de-DE')} MB`;
    if (input.contentLength !== null && input.contentLength > max) {
      throw new AppError(413, 'IMPORT_TOO_LARGE', `Die Datei ist zu groß (höchstens ${maxText}). Das Limit lässt sich mit IMPORT_MAX_MB anpassen.`);
    }
    if (input.serverId !== null) {
      await this.serverRow(input.serverId);
      this.assertStopped(input.serverId);
    }
    await this.makeRoom();
    await mkdir(this.options.tmpDir, { recursive: true });
    await assertFreeSpace(this.freeSpace, this.options.tmpDir, (input.contentLength ?? 64 * MIB) * 2 + 128 * MIB, 'den Upload');

    const id = randomUUID();
    const dir = path.join(this.options.tmpDir, id);
    const created = this.now();
    const job: Job = {
      dir,
      facts: null,
      dto: {
        id,
        mode: input.serverId === null ? 'new' : 'replace',
        serverId: input.serverId,
        status: 'uploading',
        phase: 'upload',
        message: 'Archiv wird hochgeladen',
        error: null,
        analysis: null,
        result: null,
        createdAt: created,
        expiresAt: created + TTL_OPEN_MS,
      },
    };
    this.jobs.set(id, job);
    const file = path.join(dir, 'upload.bin');
    try {
      await mkdir(dir, { recursive: true });
      let received = 0;
      // Not stream.pipeline: on an error that would destroy the request, and with it the connection the 413 is sent on.
      const tooLarge = (): AppError => new AppError(413, 'IMPORT_TOO_LARGE', `Die Datei ist zu groß (höchstens ${maxText}). Das Limit lässt sich mit IMPORT_MAX_MB anpassen.`);
      try {
        await new Promise<void>((resolve, reject) => {
          const out = createWriteStream(file, { flags: 'wx' });
          let settled = false;
          const fail = (error: Error): void => {
            if (settled) return;
            settled = true;
            stream.pause();
            stream.removeListener('data', onData);
            out.destroy();
            reject(error);
          };
          const onData = (chunk: Buffer): void => {
            received += chunk.length;
            if (received > max) {
              fail(tooLarge());
              return;
            }
            if (!out.write(chunk)) {
              stream.pause();
              out.once('drain', () => stream.resume());
            }
          };
          stream.on('data', onData);
          stream.on('end', () => {
            if (settled) return;
            settled = true;
            out.end(() => resolve());
          });
          stream.on('error', fail);
          stream.on('close', () => {
            if (!(stream as { readableEnded?: boolean }).readableEnded) fail(Object.assign(new Error('closed'), { code: 'ERR_STREAM_PREMATURE_CLOSE' }));
          });
          out.on('error', fail);
        });
      } catch (error) {
        if (error instanceof AppError) throw error;
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOSPC') throw new AppError(507, 'DISK_FULL', 'Auf dem Datenträger ist nicht genug Speicherplatz frei.');
        if (code === 'ERR_STREAM_PREMATURE_CLOSE' || code === 'ECONNRESET' || code === 'ABORT_ERR') {
          throw new AppError(400, 'UPLOAD_ABORTED', 'Der Upload wurde abgebrochen.');
        }
        throw error;
      }
      if (received === 0) throw new AppError(400, 'UPLOAD_EMPTY', 'Es wurde keine Datei übertragen.');
    } catch (error) {
      this.jobs.delete(id);
      await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => undefined);
      throw error;
    }
    job.dto.status = 'analyzing';
    job.dto.phase = 'analyze';
    job.dto.message = 'Archiv wird geprüft';
    this.launch(job, () => this.analyze(job, file));
    return this.snapshot(job);
  }

  private async analyze(job: Job, file: string): Promise<void> {
    const content = path.join(job.dir, 'content');
    const report = await stageArchive(file, content, this.limits(), this.freeSpace, () => this.checkpoint());
    await rm(file, { force: true });
    job.dto.message = 'Welt wird untersucht';
    const facts = await gatherFacts(content);
    const proposal = await this.proposal(facts);
    const notices = this.staticNotices(facts, proposal.notice);
    job.facts = facts;
    job.dto.analysis = buildAnalysis(
      facts,
      { format: report.format, sizeBytes: report.archiveBytes, entries: report.entries, uncompressedBytes: report.bytes },
      proposal.value,
      notices,
    );
    job.dto.status = 'staged';
    job.dto.phase = null;
    job.dto.message = null;
    this.touch(job);
  }

  private staticNotices(facts: ImportFacts, extra: ImportNotice | null): ImportNotice[] {
    const out: ImportNotice[] = [];
    if (facts.level.preOneNine) {
      out.push({ code: 'WORLD_PRE_1_9', level: 'warn', needsConfirm: false, text: 'Diese Welt ist älter als Minecraft 1.9 (keine Versionsangabe in level.dat). Bitte die Minecraft-Version selbst wählen.' });
    } else if (facts.level.mcVersionApprox && facts.level.mcVersion !== null) {
      out.push({ code: 'VERSION_APPROX', level: 'info', needsConfirm: false, text: `Die Version wurde aus der Datenversion ${facts.level.dataVersion ?? ''} auf Minecraft ${facts.level.mcVersion} geschätzt.` });
    }
    if (facts.unreadableJars.length > 0) {
      out.push({ code: 'JARS_UNREADABLE', level: 'warn', needsConfirm: false, text: `Diese Dateien sind keine lesbaren Jar-Dateien: ${facts.unreadableJars.slice(0, 5).join(', ')}.` });
    }
    if (facts.world.otherWorlds.length > 0) {
      out.push({ code: 'OTHER_WORLDS', level: 'info', needsConfirm: false, text: `Weitere Welten im Archiv werden nicht übernommen: ${facts.world.otherWorlds.join(', ')}.` });
    }
    if (extra !== null) out.push(extra);
    return out;
  }

  private async proposal(facts: ImportFacts): Promise<{ value: { loader: Loader; loaderVersion: string | null; mcVersion: string | null; evidence: string[] }; notice: ImportNotice | null }> {
    const chosen = proposeLoader(facts);
    const mcVersion = facts.manifest?.server.mcVersion ?? facts.level.mcVersion;
    let loaderVersion: string | null = null;
    let notice: ImportNotice | null = null;
    if (chosen.loader !== 'vanilla' && mcVersion !== null) {
      try {
        const versions = await this.options.catalog.versions(chosen.loader, mcVersion);
        const hint = chosen.versionHint;
        const pick =
          (hint === null ? undefined : versions.find((entry) => entry.version === hint || entry.version.endsWith(`-${hint}`) || entry.version.endsWith(hint))) ??
          versions.find((entry) => entry.recommended) ??
          versions.find((entry) => entry.stable) ??
          versions[0];
        loaderVersion = pick?.version ?? null;
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        notice = {
          code: 'LOADER_VERSION_UNAVAILABLE',
          level: 'warn',
          needsConfirm: false,
          text: `Die Loader-Version für Minecraft ${mcVersion} konnte nicht ermittelt werden (${error.message}). Bitte Loader und Version selbst wählen.`,
        };
      }
    }
    return { value: { loader: chosen.loader, loaderVersion, mcVersion, evidence: chosen.evidence }, notice };
  }

  // ---- review --------------------------------------------------------------------------------

  private async serverRow(serverId: string): Promise<Server> {
    const row = (await this.options.db.select().from(servers).where(eq(servers.id, serverId)))[0];
    if (row === undefined) throw new AppError(404, 'SERVER_NOT_FOUND', 'Der Server wurde nicht gefunden.');
    return row;
  }

  private assertStopped(serverId: string): void {
    if (this.options.manager.isRunning(serverId)) {
      throw new AppError(409, 'SERVER_RUNNING', 'Der Server läuft gerade. Bitte zuerst stoppen, bevor seine Welt ersetzt wird.');
    }
  }

  private staged(id: string): Job & { facts: ImportFacts } {
    const job = this.find(id);
    if (job.dto.status !== 'staged' || job.facts === null) {
      throw new AppError(409, 'IMPORT_NOT_READY', job.dto.status === 'failed' ? (job.dto.error ?? 'Der Import ist fehlgeschlagen.') : 'Der Import ist noch nicht bereit.');
    }
    this.touch(job);
    return job as Job & { facts: ImportFacts };
  }

  // mods of the archive that the (replace-mode) server already has
  private async coveredByServer(serverId: string, facts: ImportFacts): Promise<string[]> {
    const rows = await this.options.db.select().from(modsTable).where(eq(modsTable.serverId, serverId));
    return facts.mods
      .filter((mod) =>
        rows.some(
          (row) =>
            (mod.sha512 !== null && row.sha512 === mod.sha512) ||
            (mod.fileName !== null && row.fileName === mod.fileName) ||
            (mod.modId !== null && (normalise(row.name) === normalise(mod.modId) || normalise(row.fileName).includes(normalise(mod.modId)))),
        ),
      )
      .map((mod) => mod.key);
  }

  async review(id: string, requested: ReviewTarget | null): Promise<ImportReviewDto> {
    const job = this.staged(id);
    const { facts } = job;
    let target: ReviewTarget;
    let covered: string[] = [];
    if (job.dto.mode === 'replace' && job.dto.serverId !== null) {
      const server = await this.serverRow(job.dto.serverId);
      target = { loader: server.loader, mcVersion: server.mcVersion };
      covered = await this.coveredByServer(server.id, facts);
    } else {
      if (requested === null) throw new AppError(400, 'VALIDATION_ERROR', 'Loader und Minecraft-Version fehlen.');
      target = requested;
    }
    const proposed = job.dto.analysis?.proposal.loader ?? 'vanilla';
    const modded = job.dto.analysis?.modded ?? false;
    const notices = evaluateNotices(facts, target, proposed, job.dto.mode, modded);
    if (job.dto.mode === 'replace') {
      const missing = modded ? missingNotice(missingMods(facts, { jars: [], install: covered.map((key) => ({ key, projectId: '' })) })) : null;
      if (missing !== null) notices.push(missing);
      return { notices, matches: [], modrinthAvailable: true };
    }
    const result = facts.mods.length === 0 ? { matches: [], modrinthAvailable: true } : await matchMods(facts, { modrinth: this.options.modrinth, target });
    return { notices, matches: result.matches, modrinthAvailable: result.modrinthAvailable };
  }

  private assertAcknowledged(notices: readonly ImportNotice[], acknowledged: readonly string[]): void {
    const error = notices.find((entry) => entry.level === 'error');
    if (error !== undefined) throw new AppError(409, error.code, error.text);
    const pending = notices.filter((entry) => entry.needsConfirm && !acknowledged.includes(entry.code));
    if (pending.length > 0) {
      throw new AppError(409, 'CONFIRMATION_REQUIRED', 'Bitte die Hinweise zum Import bestätigen.', { codes: pending.map((entry) => entry.code), notices: pending });
    }
  }

  private validateSelection(facts: ImportFacts, loader: Loader, selection: ModSelection): void {
    const keys = new Map(facts.mods.map((mod) => [mod.key, mod]));
    const used = new Set<string>();
    for (const key of selection.jars) {
      const mod = keys.get(key);
      if (mod === undefined || mod.origin !== 'jar' || mod.path === null) {
        throw new AppError(422, 'IMPORT_SELECTION_INVALID', 'Die Auswahl enthält eine Mod-Datei, die nicht im Archiv liegt.');
      }
      if (used.has(key)) throw new AppError(422, 'IMPORT_SELECTION_INVALID', 'Eine Mod-Datei wurde doppelt ausgewählt.');
      used.add(key);
    }
    for (const entry of selection.install) {
      if (!keys.has(entry.key)) throw new AppError(422, 'IMPORT_SELECTION_INVALID', 'Die Auswahl enthält einen unbekannten Mod.');
      if (used.has(entry.key)) throw new AppError(422, 'IMPORT_SELECTION_INVALID', 'Ein Mod wurde sowohl als Datei als auch von Modrinth ausgewählt.');
      used.add(entry.key);
    }
    if (getLoaderProfile(loader) === null && used.size > 0) {
      throw new AppError(422, 'MODS_NOT_SUPPORTED', 'Vanilla-Server unterstützen keine Mods oder Plugins.');
    }
  }

  // ---- new server from a world ---------------------------------------------------------------

  async createServer(id: string, input: CreateFromImportInput): Promise<{ server: ServerDto; job: ImportJobDto }> {
    const job = this.staged(id);
    if (job.dto.mode !== 'new') throw new AppError(409, 'IMPORT_MODE', 'Dieser Upload ist zum Ersetzen einer Welt bestimmt.');
    const { facts } = job;
    const { server: spec } = input;
    this.validateSelection(facts, spec.loader, input.selection);
    const target: ReviewTarget = { loader: spec.loader, mcVersion: spec.mcVersion };
    const notices = evaluateNotices(facts, target, job.dto.analysis?.proposal.loader ?? 'vanilla', 'new', job.dto.analysis?.modded ?? false);
    const missing = job.dto.analysis?.modded === true && getLoaderProfile(spec.loader) !== null ? missingNotice(missingMods(facts, input.selection)) : null;
    if (missing !== null) notices.push(missing);
    this.assertAcknowledged(notices, input.acknowledged);

    job.dto.status = 'applying';
    job.dto.phase = 'create';
    job.dto.message = 'Server wird angelegt';
    let server: ServerDto;
    try {
      server = await this.options.servers.create({ ...spec, eulaAccepted: spec.eulaAccepted ?? false } as CreateServerInput);
    } catch (error) {
      job.dto.status = 'staged';
      job.dto.phase = null;
      job.dto.message = null;
      throw error;
    }
    job.dto.serverId = server.id;
    this.launch(job, () => this.finishNew(job, facts, server, input));
    return { server, job: this.snapshot(job) };
  }

  private async finishNew(job: Job, facts: ImportFacts, server: ServerDto, input: CreateFromImportInput): Promise<void> {
    const serverDir = path.join(this.options.serversDir, server.id);
    const result: ImportResultDto = { serverId: server.id, folders: [], jarsPlaced: [], modsInstalled: [], modsFailed: [], safetyBackupId: null, warnings: [] };
    try {
      job.dto.phase = 'world';
      job.dto.message = 'Welt wird übernommen';
      const out = path.join(job.dir, 'out');
      const built = await buildOutput(facts.world, styleForLoader(server.loader), DEFAULT_LEVEL, out);
      const player = await convertSingleplayerPlayer(path.join(out, DEFAULT_LEVEL), facts.level).catch(() => null);
      if (player !== null) result.warnings.push('Der Spielstand des Einzelspielers wurde als Spielerdaten des Servers übernommen.');
      this.checkpoint();
      for (const folder of built.folders) {
        const target = path.join(serverDir, folder);
        await rm(target, { recursive: true, force: true });
        await moveDir(path.join(out, folder), target);
        result.folders.push(folder);
      }
      if (input.importConfig) await this.copyConfig(facts, serverDir, server.port, result);

      const profile = getLoaderProfile(server.loader);
      if (profile !== null && input.selection.jars.length > 0) {
        job.dto.phase = 'mods';
        job.dto.message = 'Mod-Dateien werden abgelegt';
        const targetDir = path.join(serverDir, profile.contentDir);
        await mkdir(targetDir, { recursive: true });
        for (const key of input.selection.jars) {
          const mod = facts.mods.find((entry) => entry.key === key) as FactMod;
          try {
            const name = sanitizeJarName(mod.fileName ?? '');
            const diskName = mod.enabled ? name : `${name}${DISABLED_SUFFIX}`;
            await moveDir(mod.path as string, path.join(targetDir, diskName));
            result.jarsPlaced.push(name);
          } catch (error) {
            result.modsFailed.push({ name: mod.name, reason: error instanceof AppError ? error.message : 'Die Datei konnte nicht abgelegt werden.' });
          }
        }
      }

      if (profile !== null && (result.jarsPlaced.length > 0 || input.selection.install.length > 0)) {
        job.dto.phase = 'install';
        job.dto.message = 'Warte auf die Installation des Servers';
        // both calls queue behind the installation, which holds the server's lock
        if (result.jarsPlaced.length > 0) {
          try {
            const report = await this.options.mods.scan(server.id);
            result.warnings.push(...report.warnings);
          } catch (error) {
            result.warnings.push(error instanceof AppError ? `Die Mod-Liste konnte nicht eingelesen werden: ${error.message}` : 'Die Mod-Liste konnte nicht eingelesen werden.');
          }
        }
        for (const entry of input.selection.install) {
          const mod = facts.mods.find((candidate) => candidate.key === entry.key) as FactMod;
          job.dto.message = `Mod wird installiert: ${mod.name}`;
          try {
            await this.options.mods.install(server.id, entry.projectId, entry.versionId);
            result.modsInstalled.push(mod.name);
          } catch (error) {
            if (error instanceof AppError && error.code === 'MOD_ALREADY_INSTALLED') {
              result.modsInstalled.push(mod.name);
              continue;
            }
            result.modsFailed.push({ name: mod.name, reason: error instanceof AppError ? error.message : 'Die Installation ist fehlgeschlagen.' });
          }
        }
      }
      await rm(job.dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => undefined);
      job.dto.result = result;
      job.dto.status = 'done';
      job.dto.phase = null;
      job.dto.message = null;
      this.touch(job);
    } catch (error) {
      const reason = error instanceof AppError ? error.message : 'unerwarteter Fehler';
      throw new AppError(
        error instanceof AppError ? error.statusCode : 500,
        error instanceof AppError ? error.code : 'IMPORT_FAILED',
        `Der Server „${server.name}“ wurde angelegt, die Welt konnte aber nicht vollständig übernommen werden: ${reason} Die Welt lässt sich über „Welt ersetzen“ erneut importieren.`,
      );
    }
  }

  private async copyConfig(facts: ImportFacts, serverDir: string, port: number, result: ImportResultDto): Promise<void> {
    const { world } = facts;
    if (world.kind === 'world') return;
    for (const item of world.configItems) {
      const source = path.join(world.root, item);
      const target = path.join(serverDir, item);
      if (item === 'server.properties') continue;
      try {
        await cp(source, target, { recursive: true, force: true });
      } catch {
        result.warnings.push(`„${item}“ konnte nicht übernommen werden.`);
      }
    }
    if (world.propertiesFile !== null) {
      try {
        await copyFile(world.propertiesFile, path.join(serverDir, 'server.properties'));
        const { doc } = await loadProperties(serverDir);
        doc.set('level-name', DEFAULT_LEVEL);
        doc.set('server-port', String(port));
        doc.set('query.port', String(port));
        await saveProperties(serverDir, doc);
      } catch {
        result.warnings.push('server.properties konnte nicht übernommen werden.');
      }
    }
  }

  // ---- replacing the world of an existing server --------------------------------------------

  async replaceWorld(serverId: string, importId: string, input: ReplaceInput): Promise<ImportJobDto> {
    const job = this.staged(importId);
    if (job.dto.mode !== 'replace' || job.dto.serverId !== serverId) {
      throw new AppError(409, 'IMPORT_MODE', 'Dieser Upload gehört nicht zu diesem Server.');
    }
    await this.serverRow(serverId);
    this.assertStopped(serverId);
    if (this.options.backups.isBusy(serverId)) throw new AppError(409, 'BACKUP_IN_PROGRESS', 'Für diesen Server läuft gerade ein Backup.');
    const review = await this.review(importId, null);
    const notices = review.notices;
    this.assertAcknowledged(notices, input.acknowledged);
    job.dto.status = 'applying';
    job.dto.phase = 'prepare';
    job.dto.message = 'Welt wird ersetzt';
    this.launch(job, () => this.options.lock.run(serverId, () => this.finishReplace(job, job.facts as ImportFacts, serverId)));
    return this.snapshot(job);
  }

  private async finishReplace(job: Job, facts: ImportFacts, serverId: string): Promise<void> {
    const server = await this.serverRow(serverId);
    this.assertStopped(serverId);
    const serverDir = path.join(this.options.serversDir, serverId);
    const level = await readLevelName(serverDir);
    const result: ImportResultDto = { serverId, folders: [], jarsPlaced: [], modsInstalled: [], modsFailed: [], safetyBackupId: null, warnings: [] };
    const staging = path.join(serverDir, `.import-new-${randomUUID()}`);
    const trash = path.join(serverDir, `.import-old-${randomUUID()}`);
    let swapped = false;
    this.options.manager.announce(serverId, 'Welt wird durch einen Import ersetzt ...');
    try {
      const needed = await this.sizeOf(job.dir);
      await assertFreeSpace(this.freeSpace, serverDir, needed + 64 * MIB, 'das Ersetzen der Welt');

      job.dto.phase = 'safety';
      job.dto.message = 'Sicherheits-Backup der bisherigen Welt wird erstellt';
      const safety = await this.options.backups.safetyBackupLocked(serverId, 'Automatisch vor dem Ersetzen der Welt durch einen Import erstellt.');
      result.safetyBackupId = safety?.id ?? null;
      this.checkpoint();

      job.dto.phase = 'world';
      job.dto.message = 'Welt wird übernommen';
      const out = path.join(job.dir, 'out');
      const built = await buildOutput(facts.world, styleForLoader(server.loader), level, out);
      const player = await convertSingleplayerPlayer(path.join(out, level), facts.level).catch(() => null);
      if (player !== null) result.warnings.push('Der Spielstand des Einzelspielers wurde als Spielerdaten des Servers übernommen.');
      await mkdir(staging, { recursive: true });
      for (const folder of built.folders) await moveDir(path.join(out, folder), path.join(staging, folder));
      this.checkpoint();

      job.dto.phase = 'swap';
      job.dto.message = 'Neue Welt wird eingesetzt';
      await swapWorlds(serverDir, staging, trash, built.folders, [...worldNames(level)]);
      swapped = true;
      // the old data is only needed until the swap succeeded; leftovers must be gone before the job reports "done"
      await rm(trash, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch((error: unknown) =>
        this.logger.warn({ err: error, serverId }, 'Alte Weltdaten nach dem Import konnten nicht entfernt werden'),
      );
      await rm(staging, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => undefined);
      await rm(job.dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => undefined);
      result.folders = built.folders;
      job.dto.result = result;
      job.dto.status = 'done';
      job.dto.phase = null;
      job.dto.message = null;
      this.touch(job);
      this.options.manager.announce(serverId, 'Die Welt wurde durch den Import ersetzt.');
    } catch (error) {
      const reason = error instanceof AppError ? error.message : 'unerwarteter Fehler';
      this.options.manager.announce(serverId, `Welt-Import fehlgeschlagen, die bisherige Welt bleibt erhalten: ${reason}`);
      throw error;
    } finally {
      await rm(staging, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => undefined);
      if (swapped) {
        await rm(trash, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch((error: unknown) =>
          this.logger.warn({ err: error, serverId }, 'Alte Weltdaten nach dem Import konnten nicht entfernt werden'),
        );
        await rm(job.dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => undefined);
      } else {
        // only succeeds on an empty folder, which is the case once everything has been put back
        await rmdir(trash).catch(() => undefined);
      }
    }
  }

  private async sizeOf(dir: string): Promise<number> {
    let total = 0;
    const visit = async (current: string, depth: number): Promise<void> => {
      if (depth > 64) return;
      for (const entry of await readdir(current, { withFileTypes: true }).catch(() => [])) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) await visit(full, depth + 1);
        else if (entry.isFile()) total += (await stat(full).catch(() => ({ size: 0 }))).size;
      }
    };
    await visit(dir, 0);
    return total;
  }
}
