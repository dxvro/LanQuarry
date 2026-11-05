import type {
  AppEvent,
  AuthStatus,
  BackupDto,
  BackupListResponse,
  BackupSchedule,
  Category,
  ConsoleClientCommand,
  ConsoleLine,
  ConsoleServerMessage,
  CreateServerInput,
  EventsServerMessage,
  HealthInfo,
  InstallLogLine,
  InstallLogView,
  InstallResult,
  JavaInstallResponse,
  JavaInstallState,
  JavaRuntime,
  LoaderInfo,
  LoaderVersion,
  ManagedJavaDto,
  McVersion,
  Mod,
  ModBackupEntry,
  ModBackupList,
  ModUpdateLogEntry,
  PropertiesPatch,
  PropertiesView,
  RemoveResult,
  RestoreResponse,
  RuntimeStatus,
  ScanReport,
  SearchIndex,
  SearchResponse,
  ServerDto,
  SystemInfo,
  ToggleResult,
  TypedProperties,
  UpdateCandidate,
  UpdateResult,
  UpdateServerInput,
} from '@craftmanager/backend/contract';

export type {
  AppEvent,
  AuthStatus,
  BackupSchedule,
  Category,
  ConsoleClientCommand,
  ConsoleLine,
  ConsoleServerMessage,
  CreateServerInput,
  EventsServerMessage,
  HealthInfo,
  InstallLogLine,
  InstallLogView,
  InstallResult,
  JavaInstallResponse,
  JavaInstallState,
  JavaRuntime,
  LoaderInfo,
  LoaderVersion,
  ManagedJavaDto,
  McVersion,
  PropertiesPatch,
  PropertiesView,
  RuntimeStatus,
  ScanReport,
  SearchIndex,
  SearchResponse,
  SystemInfo,
  TypedProperties,
  UpdateCandidate,
  UpdateResult,
  UpdateServerInput,
};
export type { BackupKind, BackupStatus, ConsoleStream, DependencyType, InstallState, Loader, ServerState, UpdateStatus } from '@craftmanager/backend/contract';

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
export type BackupView = Wire<BackupDto>;
export type BackupListView = Wire<BackupListResponse>;
export type RestoreView = Wire<RestoreResponse>;
export type ToggleView = Wire<ToggleResult>;
export type ModBackupListView = ModBackupList;
export type ModBackupView = ModBackupEntry;
export type ModLogEntry = Wire<ModUpdateLogEntry>;
export type RemoveResultView = Wire<RemoveResult>;
export type InstallResultView = Wire<InstallResult>;

export interface ScanAndUpdates {
  updates: UpdateCandidate[];
  scan: ScanReport;
}
