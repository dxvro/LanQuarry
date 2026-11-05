// Wire types of the HTTP and WebSocket API. The frontend imports this file with `import type` only, so it
// must stay free of runtime dependencies on Node: every import below is type-only or reaches a pure module.
import type { DependencyType, InstallState, Loader, ModSource, UpdateStatus } from './db/enums.js';
import type { Mod, ModDependency, ModUpdateLogEntry, Server } from './db/schema.js';
import type { AppEvent } from './events/bus.js';
import type { LaunchSpec } from './installer/launch-spec.js';
import type { JavaRuntime } from './java/select.js';
import type { Category, SearchIndex, VersionType } from './modrinth/types.js';
import type { ConsoleLine, RuntimeStatus } from './process/types.js';
import type { PropertiesPatch, TypedProperties } from './properties/typed.js';
import type { CreateServerInput, UpdateServerInput } from './servers/schemas.js';

export type {
  AppEvent,
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

export interface ScanReport {
  scanned: number;
  added: number;
  renamed: number;
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

