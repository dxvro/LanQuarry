import type {
  AppEvent,
  AuthStatus,
  Category,
  ConsoleClientCommand,
  ConsoleLine,
  ConsoleServerMessage,
  CreateServerInput,
  EventsServerMessage,
  HealthInfo,
  InstallResult,
  JavaRuntime,
  LoaderInfo,
  LoaderVersion,
  McVersion,
  Mod,
  ModUpdateLogEntry,
  PropertiesPatch,
  PropertiesView,
  RemoveResult,
  RuntimeStatus,
  ScanReport,
  SearchIndex,
  SearchResponse,
  ServerDto,
  SystemInfo,
  UpdateCandidate,
  UpdateResult,
  UpdateServerInput,
} from '@craftmanager/backend/contract';

export type {
  AppEvent,
  AuthStatus,
  Category,
  ConsoleClientCommand,
  ConsoleLine,
  ConsoleServerMessage,
  CreateServerInput,
  EventsServerMessage,
  HealthInfo,
  InstallResult,
  JavaRuntime,
  LoaderInfo,
  LoaderVersion,
  McVersion,
  PropertiesPatch,
  PropertiesView,
  RuntimeStatus,
  ScanReport,
  SearchIndex,
  SearchResponse,
  SystemInfo,
  UpdateCandidate,
  UpdateResult,
  UpdateServerInput,
};
export type { ConsoleStream, DependencyType, InstallState, Loader, ServerState, UpdateStatus } from '@craftmanager/backend/contract';

// What the types of the backend look like after JSON.stringify: dates become ISO strings.
export type Wire<T> = T extends Date
  ? string
  : T extends readonly (infer U)[]
    ? Wire<U>[]
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;

export type ServerView = Wire<ServerDto>;
export type ModView = Wire<Mod>;
export type ModLogEntry = Wire<ModUpdateLogEntry>;
export type RemoveResultView = Wire<RemoveResult>;
export type InstallResultView = Wire<InstallResult>;

export interface ScanAndUpdates {
  updates: UpdateCandidate[];
  scan: ScanReport;
}
