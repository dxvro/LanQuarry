import { eq } from 'drizzle-orm';
import path from 'node:path';
import type { PropertiesView } from '../contract.js';
import type { Db } from '../db/client.js';
import { servers } from '../db/schema.js';
import { AppError } from '../http/errors.js';
import { mcAtMost } from '../installer/mc-version.js';
import type { KeyedLock } from '../lib/keyed-lock.js';
import type { ServerRuntimeGuard } from '../mods/runtime-guard.js';
import { loadProperties, saveProperties } from './store.js';
import { applyPatch, extraProperties, readTyped, type PropertiesPatch } from './typed.js';

export type { PropertiesView };

export interface PropertiesServiceOptions {
  db: Db;
  serversDir: string;
  lock: KeyedLock;
  guard: ServerRuntimeGuard;
}

export class PropertiesService {
  constructor(private readonly options: PropertiesServiceOptions) {}

  private async serverRow(serverId: string): Promise<{ port: number; mcVersion: string }> {
    const row = (await this.options.db.select({ port: servers.port, mcVersion: servers.mcVersion }).from(servers).where(eq(servers.id, serverId)))[0];
    if (row === undefined) throw new AppError(404, 'SERVER_NOT_FOUND', 'Der Server wurde nicht gefunden.');
    return row;
  }

  private dir(serverId: string): string {
    return path.join(this.options.serversDir, serverId);
  }

  async read(serverId: string): Promise<PropertiesView> {
    const dbPort = (await this.serverRow(serverId)).port;
    const { doc, exists } = await loadProperties(this.dir(serverId));
    const properties = readTyped(doc);
    // without a file the server will start on the port that was chosen at creation
    return { exists, properties: exists ? properties : { ...properties, 'server-port': dbPort }, extra: extraProperties(doc) };
  }

  patch(serverId: string, patch: PropertiesPatch): Promise<PropertiesView & { restartRequired: boolean }> {
    return this.options.lock.run(serverId, async () => {
      const { port: dbPort, mcVersion } = await this.serverRow(serverId);
      const { doc, exists } = await loadProperties(this.dir(serverId));
      if (!exists) doc.set('server-port', String(dbPort));
      applyPatch(doc, patch, mcAtMost(mcVersion, 1, 12, 2));
      await saveProperties(this.dir(serverId), doc);
      // the file is authoritative; the database follows it only after the file was written
      const port = patch['server-port'];
      if (port !== undefined && port !== dbPort) {
        await this.options.db.transaction((tx) =>
          tx.update(servers).set({ port, updatedAt: new Date() }).where(eq(servers.id, serverId)),
        );
      }
      return {
        exists: true,
        properties: readTyped(doc),
        extra: extraProperties(doc),
        restartRequired: this.options.guard.isRunning(serverId),
      };
    });
  }
}
