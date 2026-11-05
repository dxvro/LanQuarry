import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { buildApp } from './app.js';
import { ConfigError, loadConfig, loadDotEnv } from './config/env.js';
import { openDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { getLanUrls } from './lib/network.js';
import { readVersion } from './lib/version.js';
import { ModrinthClient } from './modrinth/client.js';
import { realSpawner } from './process/spawner.js';

const SHUTDOWN_EXTRA_WAIT_MS = 15_000;

function isAddrInUse(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'EADDRINUSE';
}

async function main(): Promise<void> {
  const configFile = loadDotEnv();
  const config = loadConfig();

  await mkdir(config.dataDir, { recursive: true });
  await mkdir(config.serversDir, { recursive: true });

  const handle = await openDb(path.join(config.dataDir, 'craftmanager.db'));
  await runMigrations(handle.db);

  const userAgent = config.modrinthUserAgent ?? `LocalMC-CraftManager/${readVersion()}`;
  const app = buildApp({
    db: handle.db,
    config,
    modrinth: new ModrinthClient({ userAgent }),
    spawner: realSpawner,
  });
  const { manager } = app.services;

  let shuttingDown = false;
  const shutdown = async (signal: string, exitCode = 0): Promise<void> => {
    if (shuttingDown) {
      app.log.warn(`${signal} empfangen, das Herunterfahren läuft bereits. Bitte warten, damit Weltdaten sicher gespeichert werden.`);
      return;
    }
    shuttingDown = true;
    app.log.info(`${signal} empfangen, fahre herunter ...`);
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

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    handle.close();
    if (isAddrInUse(error)) {
      console.error(
        `Port ${config.port} ist bereits belegt. Setze in der Datei .env einen anderen Wert, z. B. PORT=${config.port + 1}, oder beende das andere Programm.`,
      );
      process.exit(1);
    }
    throw error;
  }

  app.log.info(
    `Konfiguration: ${configFile === null ? 'keine .env-Datei, es gelten Umgebungsvariablen und Standardwerte' : configFile}; Daten: ${config.dataDir}; Server: ${config.serversDir}`,
  );
  if (config.authToken === undefined) {
    app.log.warn(
      'ACHTUNG: Es ist kein AUTH_TOKEN gesetzt. Jeder im Netzwerk, der diesen Port erreicht, kann Server starten, Befehle ausführen und Dateien verwalten. Nur in vertrauenswürdigen Netzwerken betreiben.',
    );
  }
  const urls = getLanUrls(config.port);
  app.log.info(`Erreichbar im lokalen Netzwerk unter: ${urls.length > 0 ? urls.join(', ') : '(keine LAN-Adresse gefunden)'}`);
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(error.message);
  } else {
    console.error('Start fehlgeschlagen:', error);
  }
  process.exit(1);
});
