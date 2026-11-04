import { eq } from 'drizzle-orm';
import { appendFile, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Db } from '../db/client.js';
import type { InstallState } from '../db/enums.js';
import { servers, type Server } from '../db/schema.js';
import type { EventBus } from '../events/bus.js';
import { AppError } from '../http/errors.js';
import type { JavaService } from '../java/service.js';
import type { KeyedLock } from '../lib/keyed-lock.js';
import { silentLogger, type Logger } from '../lib/logger.js';
import { downloadToTmp } from '../mods/downloader.js';
import { removeQuietly } from '../mods/files.js';
import { rethrowFsError } from '../mods/fs-errors.js';
import type { ServerRuntimeGuard } from '../mods/runtime-guard.js';
import type { LoaderCatalog } from './catalog.js';
import { LOADER_INFO } from './catalog.js';
import { detectForgeLaunch } from './detect-launch.js';
import { serializeLaunchSpec, type LaunchSpec } from './launch-spec.js';
import type { InstallerRunner } from './runner.js';
import type { ResolvedInstall } from './types.js';

export const INSTALL_LOG_FILE = 'install.log';
const INSTALLER_TIMEOUT_MS = 10 * 60_000;
const TAIL_LINES = 15;
const MAX_ERROR_LENGTH = 3000;
const PROGRESS_INTERVAL_MS = 250;

export interface InstallServiceOptions {
  db: Db;
  serversDir: string;
  lock: KeyedLock;
  bus: EventBus;
  catalog: LoaderCatalog;
  java: JavaService;
  runner: InstallerRunner;
  guard: ServerRuntimeGuard;
  logger?: Logger;
  installerTimeoutMs?: number;
}

const notFound = (): AppError => new AppError(404, 'SERVER_NOT_FOUND', 'Der Server wurde nicht gefunden.');

class LogFile {
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly bus: EventBus,
    private readonly serverId: string,
  ) {}

  write(line: string): void {
    this.bus.emit({ type: 'install.log', serverId: this.serverId, line });
    const text = `${new Date().toISOString()} ${line}\n`;
    this.chain = this.chain.then(() => appendFile(this.file, text, 'utf8')).catch(() => undefined);
  }

  flush(): Promise<void> {
    return this.chain;
  }
}

export class InstallService {
  private readonly jobs = new Map<string, Promise<void>>();
  private readonly abort = new AbortController();
  private readonly logger: Logger;

  constructor(private readonly options: InstallServiceOptions) {
    this.logger = options.logger ?? silentLogger;
  }

  isBusy(serverId: string): boolean {
    return this.jobs.has(serverId);
  }

  // resolves once every queued or running installation has ended
  async idle(): Promise<void> {
    while (this.jobs.size > 0) await Promise.allSettled([...this.jobs.values()]);
  }

  async shutdown(timeoutMs = 10_000): Promise<void> {
    this.abort.abort();
    await Promise.race([this.idle(), new Promise<void>((resolve) => setTimeout(resolve, timeoutMs).unref())]);
  }

  // anything still marked "installing" at boot was cut off by a crash or restart
  async recoverInterrupted(): Promise<number> {
    const stuck = await this.options.db.select({ id: servers.id }).from(servers).where(eq(servers.installState, 'installing'));
    if (stuck.length === 0) return 0;
    await this.options.db.transaction((tx) =>
      tx
        .update(servers)
        .set({ installState: 'failed', installError: 'Die Installation wurde unterbrochen (Anwendung wurde beendet).', updatedAt: new Date() })
        .where(eq(servers.installState, 'installing')),
    );
    return stuck.length;
  }

  // Validates and queues the job; the installation itself runs in the background.
  async enqueue(serverId: string, options: { checkJava: boolean }): Promise<void> {
    if (this.jobs.has(serverId)) throw new AppError(409, 'INSTALL_IN_PROGRESS', 'Die Installation läuft bereits.');
    // reserved before the first await, so a concurrent call cannot pass the same checks
    let release: () => void = () => undefined;
    this.jobs.set(
      serverId,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    let queued = false;
    try {
      await this.validate(serverId, options);
      const job: Promise<void> = this.options.lock
        .run(serverId, () => this.execute(serverId))
        .catch((error: unknown) => this.logger.error({ err: error, serverId }, 'Installation: unerwarteter Fehler'))
        .finally(() => {
          if (this.jobs.get(serverId) === job) this.jobs.delete(serverId);
        });
      this.jobs.set(serverId, job);
      queued = true;
    } finally {
      if (!queued) this.jobs.delete(serverId);
      release();
    }
  }

  private async validate(serverId: string, options: { checkJava: boolean }): Promise<void> {
    const server = (await this.options.db.select().from(servers).where(eq(servers.id, serverId)))[0];
    if (server === undefined) throw notFound();
    if (this.options.guard.isRunning(serverId)) {
      throw new AppError(409, 'SERVER_RUNNING', 'Der Server läuft gerade. Bitte zuerst stoppen, bevor er neu installiert wird.');
    }
    if (server.installState === 'installing') {
      throw new AppError(409, 'INSTALL_IN_PROGRESS', 'Die Installation läuft bereits.');
    }
    if (server.installState === 'installed') {
      throw new AppError(409, 'ALREADY_INSTALLED', 'Der Server ist bereits installiert.');
    }
    if (options.checkJava && LOADER_INFO[server.loader].requiresInstallerJava) {
      await this.options.java.select({
        javaPath: server.javaPath,
        loader: server.loader,
        mcVersion: server.mcVersion,
        requiredMajor: server.requiredJavaMajor,
      });
    }
  }

  private serverDir(serverId: string): string {
    return path.join(this.options.serversDir, serverId);
  }

  private async setState(serverId: string, installState: InstallState, installError: string | null, extra: Partial<Server> = {}): Promise<void> {
    await this.options.db.transaction((tx) =>
      tx.update(servers).set({ installState, installError, updatedAt: new Date(), ...extra }).where(eq(servers.id, serverId)),
    );
    this.options.bus.emit({ type: 'install.state', serverId, installState, installError });
  }

  private progress(serverId: string, phase: string, percent: number | null, message: string): void {
    this.options.bus.emit({ type: 'install.progress', serverId, phase, percent, message });
  }

  private async execute(serverId: string): Promise<void> {
    const server = (await this.options.db.select().from(servers).where(eq(servers.id, serverId)))[0];
    // the state may have changed while the job waited for the lock
    if (server === undefined || server.installState === 'installed' || this.options.guard.isRunning(serverId)) return;
    const dir = this.serverDir(serverId);
    await mkdir(dir, { recursive: true });
    const log = new LogFile(path.join(dir, INSTALL_LOG_FILE), this.options.bus, serverId);
    log.write(`=== Installation von ${server.loader} ${server.mcVersion}${server.loaderVersion === null ? '' : ` ${server.loaderVersion}`} gestartet ===`);
    await this.setState(serverId, 'installing', null);
    try {
      const result = await this.install(server, dir, log);
      await this.setState(serverId, 'installed', null, result);
      this.progress(serverId, 'done', 100, 'Installation abgeschlossen');
      log.write('=== Installation abgeschlossen ===');
    } catch (error) {
      const message = this.describe(error);
      this.logger.error({ err: error, serverId }, 'Installation fehlgeschlagen');
      log.write(`FEHLER: ${message}`);
      await this.setState(serverId, 'failed', message).catch((stateError: unknown) =>
        this.logger.error({ err: stateError, serverId }, 'Fehlerstatus konnte nicht gespeichert werden'),
      );
    } finally {
      await rm(path.join(dir, '.tmp'), { recursive: true, force: true }).catch(() => undefined);
      await log.flush();
    }
  }

  private describe(error: unknown): string {
    const text = error instanceof AppError ? error.message : 'Bei der Installation ist ein unerwarteter Fehler aufgetreten.';
    return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH)} ...` : text;
  }

  private async install(server: Server, dir: string, log: LogFile): Promise<Partial<Server>> {
    const { catalog, java } = this.options;
    const signal = this.abort.signal;
    const checkAborted = (): void => {
      if (signal.aborted) throw new AppError(500, 'INSTALL_ABORTED', 'Die Installation wurde unterbrochen (Anwendung wird beendet).');
    };

    this.progress(server.id, 'resolve', null, 'Version wird ermittelt');
    log.write('Version wird bei der Quelle abgefragt ...');
    const plan = await catalog.resolve(server.loader, server.mcVersion, server.loaderVersion);
    for (const note of plan.notes) log.write(`Hinweis: ${note}`);
    log.write(`Quelle: ${plan.artifact.url}`);
    checkAborted();

    const needsJava = plan.mode.kind === 'installer';
    let javaPath = '';
    if (needsJava) {
      const selection = await java.select({
        javaPath: server.javaPath,
        loader: server.loader,
        mcVersion: server.mcVersion,
        requiredMajor: plan.requiredJavaMajor,
      });
      javaPath = selection.runtime.path;
      log.write(`Verwende Java ${selection.runtime.major} (${selection.runtime.path})`);
      for (const warning of selection.warnings) log.write(`Hinweis: ${warning}`);
    }

    const tmpDir = path.join(dir, '.tmp');
    await rm(tmpDir, { recursive: true, force: true });
    let lastReport = 0;
    const part = await downloadToTmp(
      {
        url: plan.artifact.url,
        fileName: plan.artifact.fileName,
        ...(plan.artifact.hash === undefined ? {} : { hash: plan.artifact.hash }),
        ...(plan.artifact.size === undefined ? {} : { size: plan.artifact.size }),
        allowedHosts: plan.artifact.allowedHosts,
        requireZip: plan.artifact.requireZip,
        onProgress: (received, total) => {
          const now = Date.now();
          if (now - lastReport < PROGRESS_INTERVAL_MS && received !== total) return;
          lastReport = now;
          const percent = total === null || total === 0 ? null : Math.min(99, Math.floor((received / total) * 100));
          this.progress(server.id, 'download', percent, `${plan.artifact.fileName}: ${Math.round(received / 1024)} KiB`);
        },
      },
      tmpDir,
      catalog.downloader,
    );
    log.write(`Download abgeschlossen${plan.artifact.hash === undefined ? '' : ` (${plan.artifact.hash.algorithm} geprüft)`}`);
    const target = path.join(dir, plan.artifact.fileName);
    try {
      await rename(part, target);
    } catch (error) {
      await removeQuietly(part);
      rethrowFsError(error, plan.artifact.fileName);
    }
    checkAborted();

    let launch: LaunchSpec;
    if (plan.mode.kind === 'jar') {
      launch = { kind: 'jar', jar: plan.mode.launchJar };
    } else {
      try {
        launch = await this.runInstaller(server, plan, javaPath, dir, log);
      } finally {
        await rm(target, { force: true }).catch(() => undefined);
      }
    }
    log.write(`Startdatei: ${launch.kind === 'jar' ? launch.jar : launch.unixFile}`);
    return {
      launchSpec: serializeLaunchSpec(launch),
      requiredJavaMajor: plan.requiredJavaMajor,
      loaderVersion: plan.loaderVersion,
    };
  }

  private async runInstaller(server: Server, plan: ResolvedInstall, javaPath: string, dir: string, log: LogFile): Promise<LaunchSpec> {
    if (plan.mode.kind !== 'installer') throw new AppError(500, 'INTERNAL_ERROR', 'Ungültiger Installationsmodus.');
    this.progress(server.id, 'install', null, 'Installer läuft');
    log.write(`Installer wird ausgeführt: java -jar ${plan.artifact.fileName} ${plan.mode.arguments.join(' ')}`);
    const tail: string[] = [];
    const timeoutMs = this.options.installerTimeoutMs ?? INSTALLER_TIMEOUT_MS;
    let result;
    try {
      result = await this.options.runner({
        javaPath,
        args: ['-jar', plan.artifact.fileName, ...plan.mode.arguments],
        cwd: dir,
        timeoutMs,
        signal: this.abort.signal,
        onLine: (line) => {
          log.write(line);
          tail.push(line);
          if (tail.length > TAIL_LINES) tail.shift();
        },
      });
    } catch (error) {
      this.logger.error({ err: error }, 'Installer konnte nicht gestartet werden');
      throw new AppError(500, 'INSTALLER_FAILED', 'Der Installer konnte nicht gestartet werden. Ist die Java-Datei gültig?');
    }
    const output = tail.length === 0 ? '' : `\nLetzte Ausgabe:\n${tail.join('\n')}`;
    if (result.aborted) throw new AppError(500, 'INSTALL_ABORTED', 'Die Installation wurde unterbrochen (Anwendung wird beendet).');
    if (result.timedOut) {
      throw new AppError(500, 'INSTALLER_TIMEOUT', `Der Installer wurde nach ${Math.round(timeoutMs / 60_000)} Minuten abgebrochen.${output}`);
    }
    if (result.exitCode !== 0) {
      throw new AppError(500, 'INSTALLER_FAILED', `Der Installer ist mit Exit-Code ${result.exitCode ?? 'unbekannt'} fehlgeschlagen.${output}`);
    }
    if (server.loader !== 'forge' && server.loader !== 'neoforge') {
      throw new AppError(500, 'INTERNAL_ERROR', 'Ungültiger Installationsmodus.');
    }
    return detectForgeLaunch(dir, server.loader, server.mcVersion, plan.loaderVersion);
  }
}
