import type { AppConfig } from './config/env.js';
import type { Db } from './db/client.js';
import { EventBus } from './events/bus.js';
import { Auth } from './http/auth.js';
import { LoaderCatalog } from './installer/catalog.js';
import { createInstallerRunner, type InstallerRunner } from './installer/runner.js';
import { InstallService } from './installer/service.js';
import { JavaService } from './java/service.js';
import { KeyedLock } from './lib/keyed-lock.js';
import { silentLogger, type Logger } from './lib/logger.js';
import { readVersion } from './lib/version.js';
import type { DownloaderOptions } from './mods/downloader.js';
import { ModService } from './mods/service.js';
import type { ServerRuntimeGuard } from './mods/runtime-guard.js';
import type { ModrinthApi } from './modrinth/types.js';
import { ProcessManager } from './process/manager.js';
import type { SampleReader } from './process/metrics.js';
import type { PortProbe } from './process/ports.js';
import { realSpawner, type ProcessSpawner } from './process/spawner.js';
import { PropertiesService } from './properties/service.js';
import { ServerService } from './servers/service.js';

export interface ServiceOptions {
  db: Db;
  config: AppConfig;
  modrinth: ModrinthApi;
  logger?: Logger;
  // Phase 2 compatibility: replaces the process manager as the guard seen by the mod service
  runtimeGuard?: ServerRuntimeGuard;
  downloader?: DownloaderOptions;
  catalog?: LoaderCatalog;
  fetch?: typeof fetch;
  java?: JavaService;
  spawner?: ProcessSpawner;
  installerRunner?: InstallerRunner;
  portProbe?: PortProbe;
  readSamples?: SampleReader;
  platform?: NodeJS.Platform;
  totalMemoryMb?: () => number;
  timings?: {
    startWarningMs?: number;
    closeGraceMs?: number;
    metricsIntervalMs?: number;
    installerTimeoutMs?: number;
    loginFailureDelayMs?: number;
  };
}

export interface Services {
  lock: KeyedLock;
  bus: EventBus;
  catalog: LoaderCatalog;
  java: JavaService;
  manager: ProcessManager;
  install: InstallService;
  servers: ServerService;
  properties: PropertiesService;
  mods: ModService;
  auth: Auth;
}

export function createServices(options: ServiceOptions): Services {
  const { db, config } = options;
  const logger = options.logger ?? silentLogger;
  const timings = options.timings ?? {};
  const lock = new KeyedLock();
  const bus = new EventBus();
  const userAgent = config.modrinthUserAgent ?? `LocalMC-CraftManager/${readVersion()}`;
  const catalog = options.catalog ?? new LoaderCatalog({ fetch: options.fetch ?? fetch, userAgent });
  const java = options.java ?? new JavaService();
  const spawner = options.spawner ?? realSpawner;

  // the hook is wired after the mod service exists; the manager only calls it once a server has started
  const hooks: { modService?: ModService } = {};
  const manager = new ProcessManager({
    db,
    serversDir: config.serversDir,
    lock,
    spawner,
    java,
    bus,
    logger,
    stopTimeoutMs: config.stopTimeoutMs,
    ...(options.platform === undefined ? {} : { platform: options.platform }),
    ...(options.portProbe === undefined ? {} : { probePort: options.portProbe }),
    ...(options.readSamples === undefined ? {} : { readSamples: options.readSamples }),
    ...(timings.startWarningMs === undefined ? {} : { startWarningMs: timings.startWarningMs }),
    ...(timings.closeGraceMs === undefined ? {} : { closeGraceMs: timings.closeGraceMs }),
    ...(timings.metricsIntervalMs === undefined ? {} : { metricsIntervalMs: timings.metricsIntervalMs }),
    onStarted: (server) => {
      if (server.loader === 'vanilla' || hooks.modService === undefined) return;
      hooks.modService
        .checkUpdates(server.id)
        .then(({ updates }) =>
          bus.emit({
            type: 'mods.updates',
            serverId: server.id,
            ok: true,
            count: updates.length,
            projects: updates.map((update) => update.name),
            error: null,
          }),
        )
        .catch((error: unknown) => {
          logger.error({ err: error, serverId: server.id }, 'Update-Prüfung nach dem Serverstart fehlgeschlagen');
          bus.emit({
            type: 'mods.updates',
            serverId: server.id,
            ok: false,
            count: 0,
            projects: [],
            error: 'Die Update-Prüfung ist fehlgeschlagen.',
          });
        });
    },
  });

  const guard = options.runtimeGuard ?? manager;
  const mods = new ModService({
    db,
    modrinth: options.modrinth,
    guard,
    serversDir: config.serversDir,
    lock,
    logger,
    ...(options.downloader === undefined ? {} : { downloader: options.downloader }),
  });
  hooks.modService = mods;

  const install = new InstallService({
    db,
    serversDir: config.serversDir,
    lock,
    bus,
    catalog,
    java,
    runner: options.installerRunner ?? createInstallerRunner(spawner),
    guard: manager,
    logger,
    ...(timings.installerTimeoutMs === undefined ? {} : { installerTimeoutMs: timings.installerTimeoutMs }),
  });
  const servers = new ServerService({
    db,
    serversDir: config.serversDir,
    lock,
    bus,
    catalog,
    java,
    install,
    manager,
    ...(options.totalMemoryMb === undefined ? {} : { totalMemoryMb: options.totalMemoryMb }),
  });
  const properties = new PropertiesService({ db, serversDir: config.serversDir, lock, guard: manager });
  const auth = new Auth({
    token: config.authToken,
    ...(timings.loginFailureDelayMs === undefined ? {} : { failureDelayMs: timings.loginFailureDelayMs }),
  });
  return { lock, bus, catalog, java, manager, install, servers, properties, mods, auth };
}
