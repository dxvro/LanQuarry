import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, realpath, rm, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Db } from '../db/client.js';
import type { ServerDto } from '../contract.js';
import { servers, type Server } from '../db/schema.js';
import type { BackupDisposal, BackupService } from '../backups/service.js';
import type { EventBus } from '../events/bus.js';
import { AppError } from '../http/errors.js';
import type { LoaderCatalog } from '../installer/catalog.js';
import { parseLaunchSpec } from '../installer/launch-spec.js';
import type { InstallService } from '../installer/service.js';
import type { JavaService } from '../java/service.js';
import type { KeyedLock } from '../lib/keyed-lock.js';
import { rethrowFsError } from '../mods/fs-errors.js';
import { withdrawEulaFile } from '../process/eula.js';
import type { ProcessManager } from '../process/manager.js';
import { tokenizeArgs } from '../process/tokenize.js';
import { CreateServerSchema, MIN_RAM_MB, UpdateServerSchema, type CreateServerInput, type UpdateServerInput } from './schemas.js';

export { CreateServerSchema, MIN_RAM_MB, UpdateServerSchema };
export type { CreateServerInput, ServerDto, UpdateServerInput };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_PORT_START = 25565;

export interface ServerServiceOptions {
  db: Db;
  serversDir: string;
  lock: KeyedLock;
  bus: EventBus;
  catalog: LoaderCatalog;
  java: JavaService;
  install: InstallService;
  manager: ProcessManager;
  backups: BackupService;
  totalMemoryMb?: () => number;
}

const notFound = (): AppError => new AppError(404, 'SERVER_NOT_FOUND', 'Der Server wurde nicht gefunden.');

export class ServerService {
  constructor(private readonly options: ServerServiceOptions) {}

  private toDto(row: Server): ServerDto {
    return { ...row, launchSpec: parseLaunchSpec(row.launchSpec), status: this.options.manager.status(row.id) };
  }

  async list(): Promise<ServerDto[]> {
    const rows = await this.options.db.select().from(servers).orderBy(servers.createdAt);
    return rows.map((row) => this.toDto(row));
  }

  async get(id: string): Promise<ServerDto> {
    return this.toDto(await this.row(id));
  }

  private async row(id: string): Promise<Server> {
    const row = (await this.options.db.select().from(servers).where(eq(servers.id, id)))[0];
    if (row === undefined) throw notFound();
    return row;
  }

  private totalMb(): number {
    return this.options.totalMemoryMb?.() ?? Math.floor(os.totalmem() / (1024 * 1024));
  }

  private assertRam(minRamMb: number, maxRamMb: number): void {
    if (minRamMb > maxRamMb) {
      throw new AppError(422, 'RAM_INVALID', 'Der minimale Arbeitsspeicher darf nicht größer sein als der maximale.');
    }
    const total = this.totalMb();
    if (maxRamMb > total) {
      throw new AppError(
        422,
        'RAM_EXCEEDS_SYSTEM',
        `Der maximale Arbeitsspeicher (${maxRamMb} MB) übersteigt den verfügbaren Arbeitsspeicher des Rechners (${total} MB).`,
        { maxRamMb, totalRamMb: total },
      );
    }
  }

  private async nextFreePort(): Promise<number> {
    const used = new Set((await this.options.db.select({ port: servers.port }).from(servers)).map((row) => row.port));
    let port = DEFAULT_PORT_START;
    while (used.has(port)) port++;
    return port;
  }

  async create(input: CreateServerInput): Promise<ServerDto> {
    const minRamMb = input.minRamMb ?? Math.min(1024, input.maxRamMb ?? 1024);
    const maxRamMb = input.maxRamMb ?? Math.max(2048, minRamMb);
    this.assertRam(minRamMb, maxRamMb);

    const plan = await this.options.catalog.resolve(input.loader, input.mcVersion, input.loaderVersion ?? null);
    const port = input.port ?? (await this.nextFreePort());
    const now = new Date();
    const id = randomUUID();
    await this.options.db.transaction((tx) =>
      tx.insert(servers).values({
        id,
        name: input.name,
        loader: input.loader,
        mcVersion: input.mcVersion,
        loaderVersion: plan.loaderVersion,
        requiredJavaMajor: plan.requiredJavaMajor,
        port,
        minRamMb,
        maxRamMb,
        eulaAccepted: input.eulaAccepted ?? false,
        createdAt: now,
        updatedAt: now,
      }),
    );
    await mkdir(path.join(this.options.serversDir, id), { recursive: true });
    this.options.bus.emit({ type: 'server.changed', serverId: id, reason: 'created' });
    await this.options.install.enqueue(id, { checkJava: false });
    return this.get(id);
  }

  async update(id: string, input: UpdateServerInput): Promise<{ server: ServerDto; restartRequired: boolean }> {
    const current = await this.row(id);
    const minRamMb = input.minRamMb ?? current.minRamMb;
    const maxRamMb = input.maxRamMb ?? current.maxRamMb;
    if (input.minRamMb !== undefined || input.maxRamMb !== undefined) this.assertRam(minRamMb, maxRamMb);
    if (input.extraJvmArgs !== undefined) tokenizeArgs(input.extraJvmArgs);
    if (typeof input.javaPath === 'string') await this.options.java.validatePath(input.javaPath);

    const changed = (key: keyof UpdateServerInput): boolean => input[key] !== undefined && input[key] !== current[key];
    const jvmChanged = (['minRamMb', 'maxRamMb', 'javaPath', 'useAikarFlags', 'extraJvmArgs'] as const).some(changed);
    const restartRequired = jvmChanged && this.options.manager.isRunning(id);

    await this.options.db.transaction((tx) =>
      tx
        .update(servers)
        .set({
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.minRamMb === undefined ? {} : { minRamMb }),
          ...(input.maxRamMb === undefined ? {} : { maxRamMb }),
          ...(input.javaPath === undefined ? {} : { javaPath: input.javaPath }),
          ...(input.useAikarFlags === undefined ? {} : { useAikarFlags: input.useAikarFlags }),
          ...(input.extraJvmArgs === undefined ? {} : { extraJvmArgs: input.extraJvmArgs }),
          ...(input.eulaAccepted === undefined ? {} : { eulaAccepted: input.eulaAccepted }),
          ...(input.autoStart === undefined ? {} : { autoStart: input.autoStart }),
          updatedAt: new Date(),
        })
        .where(eq(servers.id, id)),
    );
    if (input.eulaAccepted === false && current.eulaAccepted && !this.options.manager.isRunning(id)) {
      await withdrawEulaFile(path.join(this.options.serversDir, id));
    }
    this.options.bus.emit({ type: 'server.changed', serverId: id, reason: 'updated' });
    return { server: await this.get(id), restartRequired };
  }

  // `backups` says what happens to the server's backup archives; it must be given when there are any
  async remove(id: string, backups?: BackupDisposal): Promise<void> {
    await this.row(id);
    this.assertDeletable(id);
    await this.options.lock.run(id, async () => {
      const row = await this.row(id);
      this.assertDeletable(id, row);
      const archives = await this.options.backups.summary(id);
      if (archives.count > 0 && backups === undefined) {
        throw new AppError(
          409,
          'BACKUPS_DECISION_REQUIRED',
          `Für diesen Server gibt es ${archives.count} Backup(s). Bitte festlegen, ob sie mit dem Server gelöscht oder behalten werden.`,
          archives,
        );
      }
      const target = await this.safeServerDir(id);
      try {
        const info = await lstat(target).catch(() => null);
        if (info?.isSymbolicLink() === true) await unlink(target);
        else if (info !== null) await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch (error) {
        rethrowFsError(error, id);
      }
      await this.options.db.transaction((tx) => tx.delete(servers).where(eq(servers.id, id)));
      await this.options.backups.dispose(row, backups ?? 'delete');
    });
    this.options.manager.forget(id);
    this.options.bus.emit({ type: 'server.changed', serverId: id, reason: 'deleted' });
  }

  private assertDeletable(id: string, row?: Server): void {
    if (this.options.manager.isRunning(id)) {
      throw new AppError(409, 'SERVER_RUNNING', 'Der Server läuft gerade. Bitte zuerst stoppen, bevor er gelöscht wird.');
    }
    if (this.options.backups.isBusy(id)) {
      throw new AppError(409, 'BACKUP_IN_PROGRESS', 'Für diesen Server läuft gerade ein Backup. Bitte warten, bevor er gelöscht wird.');
    }
    if (this.options.install.isBusy(id) || row?.installState === 'installing') {
      throw new AppError(409, 'INSTALL_IN_PROGRESS', 'Die Installation läuft gerade. Bitte warten, bevor der Server gelöscht wird.');
    }
  }

  // the only directory ever removed: exactly <serversDir>/<uuid>, checked after resolving
  private async safeServerDir(id: string): Promise<string> {
    const unsafe = (): AppError => new AppError(409, 'UNSAFE_SERVER_PATH', 'Der Serverordner liegt an einem unerwarteten Ort und wird aus Sicherheitsgründen nicht gelöscht.');
    if (!UUID_PATTERN.test(id)) throw unsafe();
    const root = path.resolve(this.options.serversDir);
    const target = path.resolve(root, id);
    if (path.dirname(target) !== root || path.basename(target) !== id) throw unsafe();
    const realRoot = await realpath(root).catch(() => null);
    const realParent = await realpath(path.dirname(target)).catch(() => null);
    if (realRoot === null || realParent === null || realRoot !== realParent) throw unsafe();
    return target;
  }
}
