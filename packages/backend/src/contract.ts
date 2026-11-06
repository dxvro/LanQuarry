// Wire types of the HTTP and WebSocket API. The frontend imports this file with `import type` only, so it
// must stay free of runtime dependencies on Node: every import below is type-only or reaches a pure module.
import type { BackupKind, BackupStatus, DependencyType, InstallState, Loader, ModSource, UpdateStatus } from './db/enums.js';
import type { Backup, Mod, ModDependency, ModUpdateLogEntry, Server } from './db/schema.js';
import type { AppEvent } from './events/bus.js';
import type { InstallLogLine, InstallLogView } from './installer/install-log.js';
import type { LaunchSpec } from './installer/launch-spec.js';
import type { JavaRuntime } from './java/select.js';
import type { Category, SearchIndex, VersionType } from './modrinth/types.js';
import type { ConsoleLine, RuntimeStatus } from './process/types.js';
import type { PropertiesPatch, TypedProperties } from './properties/typed.js';
import type { CreateServerInput, UpdateServerInput } from './servers/schemas.js';

export type {
  AppEvent,
  BackupKind,
  BackupStatus,
  InstallLogLine,
  InstallLogView,
  Category,
  ConsoleLine,
  CreateServerInput,
  DependencyType,
  InstallState,
  JavaRuntime,
  LaunchSpec,
  Loader,
  Mod,
  ModDependency,
  ModSource,
  ModUpdateLogEntry,
  PropertiesPatch,
  RuntimeStatus,
  SearchIndex,
  TypedProperties,
  UpdateServerInput,
  UpdateStatus,
  VersionType,
};
export type { ConsoleStream, ServerState } from './process/types.js';
export type * from './worldio/dto.js';

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface ServerDto extends Omit<Server, 'launchSpec'> {
  launchSpec: LaunchSpec | null;
  status: RuntimeStatus;
}

export interface HealthInfo {
  status: 'ok';
  database: 'ok';
  version?: string;
  uptimeSeconds?: number;
  lanUrls?: string[];
}

export interface SystemInfo {
  totalMemoryMb: number;
  freeMemoryMb: number;
  cpuCount: number;
  platform: string;
  arch: string;
  javaRuntimes: JavaRuntime[];
  // whether a missing Java is installed automatically (JAVA_AUTO_INSTALL)
  javaAutoInstall: boolean;
  managedJava: ManagedJavaDto[];
  javaInstalls: JavaInstallState[];
}

export interface ManagedJavaDto {
  major: number;
  version: string;
  release: string;
  image: 'jre' | 'jdk';
  sha256: string;
  installedAt: number;
  sizeBytes: number;
  javaPath: string;
  origin: string;
  // names of running or starting servers that use it; a runtime in use cannot be removed
  inUseBy: string[];
}

export interface JavaInstallState {
  major: number;
  phase: string | null;
  percent: number | null;
  message: string | null;
}

export interface JavaInstallResponse {
  runtime: JavaRuntime;
  alreadyInstalled: boolean;
}

export interface AuthStatus {
  authRequired: boolean;
  authenticated: boolean;
}

export interface LoaderInfo {
  id: Loader;
  name: string;
  supportsMods: boolean;
  requiresInstallerJava: boolean;
}

export interface McVersion {
  id: string;
  type: 'release' | 'snapshot';
}

export interface LoaderVersion {
  version: string;
  stable: boolean;
  recommended: boolean;
}

export interface PropertiesView {
  exists: boolean;
  properties: TypedProperties;
  extra: Record<string, string>;
}

export interface SearchHitDto {
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
  // set when installed: the mod's id and whether it is switched on
  modId: string | null;
  enabled: boolean;
}

export interface SearchResponse {
  hits: SearchHitDto[];
  totalHits: number;
  offset: number;
  limit: number;
}

export interface RemoveResult {
  removed: Mod;
  orphaned: Mod[];
}

export interface ToggleResult {
  mod: Mod;
  // every mod whose state changed, the requested one first
  changed: Mod[];
  // dependencies that were switched on together with the requested mod
  dependencies: Mod[];
  warnings: string[];
}

export interface ModBackupEntry {
  fileName: string;
  sizeBytes: number;
  createdAt: number;
  modName: string | null;
  logId: number | null;
  // would be deleted by the cleanup (older than the newest N of its mod)
  removable: boolean;
}

export interface ModBackupList {
  backups: ModBackupEntry[];
  totalBytes: number;
  keep: number;
}

export interface BackupDto extends Omit<Backup, 'worlds'> {
  worlds: string[];
}

export interface BackupSchedule {
  intervalHours: number | null;
  keepLast: number;
  includeConfig: boolean;
}

export interface BackupListResponse {
  backups: BackupDto[];
  schedule: BackupSchedule;
  totalBytes: number;
  freeBytes: number | null;
  // a backup of this server is being written right now
  running: boolean;
}

export interface RestoreResponse {
  backup: BackupDto;
  safety: BackupDto | null;
  warnings: string[];
}

export interface ScanReport {
  scanned: number;
  added: number;
  renamed: number;
  // files whose state changed by a hand-made rename between .jar and .jar.disabled
  toggled: number;
  replaced: number;
  removed: number;
  identified: number;
  modrinthAvailable: boolean;
  warnings: string[];
}

export interface UpdateCandidate {
  modId: string;
  projectId: string;
  name: string;
  currentVersionId: string;
  currentVersionNumber: string;
  newVersionId: string;
  newVersionNumber: string;
  versionType: VersionType;
  newFileName: string;
}

export interface UpdateResult {
  modId: string;
  name: string;
  status: UpdateStatus;
  error?: string;
}

export interface InstallResult {
  installed: Mod[];
  // switched-off mods that were needed and are active again
  reenabled: Mod[];
  warnings: string[];
}

// ---- WebSocket messages ---------------------------------------------------------------------

export type ConsoleServerMessage =
  | { type: 'status'; status: RuntimeStatus }
  | { type: 'history'; lines: ConsoleLine[] }
  | { type: 'line'; line: ConsoleLine }
  | { type: 'ack'; id?: string }
  | { type: 'error'; code: string; message: string; id?: string }
  | { type: 'pong' };

export interface ConsoleClientCommand {
  type: 'command';
  command: string;
  id?: string;
}

export type EventsServerMessage =
  | { type: 'snapshot'; serverTime: number; servers: Array<{ serverId: string; status: RuntimeStatus }> }
  | AppEvent
  | { type: 'error'; code: string; message: string }
  | { type: 'pong' };

