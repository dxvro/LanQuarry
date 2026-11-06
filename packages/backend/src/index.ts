import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildApp } from './app.js';
import { ConfigError, loadConfig, loadDotEnv } from './config/env.js';
import { openDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { describeAccess, isWildcardHost } from './lib/network.js';
import { listenWithFallback } from './network/boot.js';
import { effectiveNetwork, readStoredNetwork } from './network/settings.js';
import { SettingsStore } from './settings/store.js';
import { readVersion } from './lib/version.js';
import { ModrinthClient } from './modrinth/client.js';
import { realSpawner } from './process/spawner.js';

const SHUTDOWN_EXTRA_WAIT_MS = 15_000;

function isAddrInUse(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'EADDRINUSE';
}

async function main(): Promise<void> {
  const configFile = loadDotEnv();
  const envConfig = loadConfig();
  const config = { ...envConfig };

  await mkdir(config.dataDir, { recursive: true });
  await mkdir(config.serversDir, { recursive: true });

  const handle = await openDb(path.join(config.dataDir, 'craftmanager.db'));
  await runMigrations(handle.db);

  // Network settings chosen in the web UI replace HOST, PORT and ALLOWED_HOSTS of the config file
  const networkDefaults = { host: envConfig.host, port: envConfig.port, allowedHosts: envConfig.allowedHosts };
  const network = effectiveNetwork(networkDefaults, await readStoredNetwork(new SettingsStore(handle.db)));
  Object.assign(config, { host: network.host, port: network.port, allowedHosts: network.allowedHosts });

  const userAgent = config.modrinthUserAgent ?? `LocalMC-CraftManager/${readVersion()}`;
  const app = buildApp({
    db: handle.db,
    config,
    modrinth: new ModrinthClient({ userAgent }),
    spawner: realSpawner,
    network: { defaults: networkDefaults },
    // "Jetzt neu starten": the normal shutdown (stops all servers cleanly), then this exit code
    restart: { exit: (code) => void shutdown('Neustart', code) },
  });
  const { manager } = app.services;

  let shuttingDown = false;
  const shutdown = async (signal: string, exitCode = 0): Promise<void> => {
    if (shuttingDown) {
      app.log.warn(`${signal} empfangen, das Herunterfahren läuft bereits. Bitte warten, damit Weltdaten sicher gespeichert werden.`);
      return;
    }
    shuttingDown = true;
    app.log.info(signal === 'Neustart' ? 'Neustart angefordert, fahre herunter ...' : `${signal} empfangen, fahre herunter ...`);
    try {
      // running servers first: the world data is the one thing that must not be lost
      await manager.shutdown(config.stopTimeoutMs + SHUTDOWN_EXTRA_WAIT_MS);
      await app.close();
    } catch (error) {
      app.log.error({ err: error }, 'Fehler beim Herunterfahren');
      exitCode = 1;
    } finally {
      handle.close();
    }
    process.exit(exitCode);
  };
  const signals: NodeJS.Signals[] = process.platform === 'win32' ? ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'] : ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const signal of signals) process.on(signal, () => void shutdown(signal));
  process.on('uncaughtException', (error) => {
    app.log.error({ err: error }, 'Unbehandelte Ausnahme');
    void shutdown('uncaughtException', 1);
  });
  process.on('unhandledRejection', (reason) => {
    app.log.error({ err: reason }, 'Unbehandelte Promise-Ablehnung');
  });

  let listening: Awaited<ReturnType<typeof listenWithFallback>>;
  try {
    listening = await listenWithFallback((options) => app.listen(options), { host: config.host, port: config.port, defaultPort: envConfig.port });
  } catch (error) {
    handle.close();
    if (isAddrInUse(error)) {
      const port = (error as { port?: unknown }).port;
      const used = typeof port === 'number' ? port : config.port;
      console.error(
        `Port ${used} ist bereits belegt. Setze in der Datei .env einen anderen Wert, z. B. PORT=${used + 1}, oder beende das andere Programm.`,
      );
      process.exit(1);
    }
    throw error;
  }
  app.services.network.setActive(listening.host, listening.port);
  for (const warning of listening.warnings) {
    app.log.warn(warning);
    app.services.network.addWarning(warning);
  }

  app.log.info(
    `Konfiguration: ${configFile === null ? 'keine .env-Datei, es gelten Umgebungsvariablen und Standardwerte' : configFile}; Daten: ${config.dataDir}; Server: ${config.serversDir}`,
  );
  if (!app.services.auth.enabled) {
    app.log.warn(
      'ACHTUNG: Es ist weder ein AUTH_TOKEN noch ein Passwort gesetzt. Jeder im Netzwerk, der diesen Port erreicht, kann Server starten, Befehle ausführen und Dateien verwalten. Unter System ein Passwort festlegen oder nur in vertrauenswürdigen Netzwerken betreiben.',
    );
  }
  const { network: networkService } = app.services;
  app.log.info(`Weboberfläche erreichbar unter: ${describeAccess(listening.host, listening.port, networkService.detected(), networkService.hostname)}`);
  // installers and the updater read the address the application really listens on from here (the port can be changed in the UI)
  await writeNetworkInfo(config.dataDir, listening.host, listening.port).catch((error: unknown) => app.log.warn({ err: error }, 'network.json konnte nicht geschrieben werden'));
}

// {"host":"0.0.0.0","port":3000,"probeHost":"127.0.0.1"}: probeHost is where a health check reaches the application
async function writeNetworkInfo(dataDir: string, host: string, port: number): Promise<void> {
  const file = path.join(dataDir, 'network.json');
  const probeHost = isWildcardHost(host) ? '127.0.0.1' : host;
  await writeFile(`${file}.tmp`, `${JSON.stringify({ host, port, probeHost, pid: process.pid })}
`, 'utf8');
  await rename(`${file}.tmp`, file);
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(error.message);
  } else {
    console.error('Start fehlgeschlagen:', error);
  }
  process.exit(1);
});
