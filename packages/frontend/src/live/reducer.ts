import type { ConnectionState } from '../lib/socket';
import type { AppEvent, EventsServerMessage, InstallState, RuntimeStatus, ServerView } from '../lib/types';

export const MAX_INSTALL_LOG_LINES = 400;

export const offlineStatus = (): RuntimeStatus => ({
  state: 'offline',
  pid: null,
  startedAt: null,
  exitCode: null,
  message: null,
  players: [],
  port: null,
  cpuPercent: null,
  rssBytes: null,
});

export interface InstallProgress {
  phase: string;
  percent: number | null;
  message: string;
  log: string[];
}

export interface CrashInfo {
  exitCode: number | null;
  lastLines: string[];
}

export interface ModUpdateInfo {
  ok: boolean;
  count: number;
  projects: string[];
  error: string | null;
}

export interface LiveState {
  connection: ConnectionState;
  // true once the event stream delivered a snapshot, from then on missing servers are offline
  snapshotSeen: boolean;
  servers: ServerView[] | null;
  statuses: Record<string, RuntimeStatus>;
  installs: Record<string, InstallProgress>;
  crashes: Record<string, CrashInfo>;
  modUpdates: Record<string, ModUpdateInfo>;
  restartNeeded: Record<string, boolean>;
}

export const initialLiveState = (): LiveState => ({
  connection: 'connecting',
  snapshotSeen: false,
  servers: null,
  statuses: {},
  installs: {},
  crashes: {},
  modUpdates: {},
  restartNeeded: {},
});

export type LiveAction =
  | { type: 'connection'; connection: ConnectionState }
  | { type: 'servers'; servers: ServerView[] }
  | { type: 'message'; message: EventsServerMessage }
  | { type: 'restart-needed'; serverId: string; needed: boolean };

const without = <T>(record: Record<string, T>, key: string): Record<string, T> => {
  const { [key]: _removed, ...rest } = record;
  return rest;
};

function patchServer(servers: ServerView[] | null, serverId: string, patch: Partial<ServerView>): ServerView[] | null {
  if (servers === null) return servers;
  return servers.map((server) => (server.id === serverId ? { ...server, ...patch } : server));
}

function reduceEvent(state: LiveState, event: AppEvent): LiveState {
  switch (event.type) {
    case 'server.status': {
      const next: LiveState = { ...state, statuses: { ...state.statuses, [event.serverId]: event.status } };
      if (event.status.state === 'starting') {
        next.crashes = without(state.crashes, event.serverId);
        next.restartNeeded = without(state.restartNeeded, event.serverId);
      }
      return next;
    }
    case 'server.metrics': {
      const current = state.statuses[event.serverId];
      if (current === undefined) return state;
      return {
        ...state,
        statuses: { ...state.statuses, [event.serverId]: { ...current, cpuPercent: event.cpuPercent, rssBytes: event.rssBytes } },
      };
    }
    case 'server.crashed':
      return { ...state, crashes: { ...state.crashes, [event.serverId]: { exitCode: event.exitCode, lastLines: event.lastLines } } };
    case 'server.changed':
      if (event.reason !== 'deleted') return state;
      return {
        ...state,
        servers: state.servers === null ? null : state.servers.filter((server) => server.id !== event.serverId),
        statuses: without(state.statuses, event.serverId),
        installs: without(state.installs, event.serverId),
        crashes: without(state.crashes, event.serverId),
        modUpdates: without(state.modUpdates, event.serverId),
        restartNeeded: without(state.restartNeeded, event.serverId),
      };
    case 'install.state': {
      const installs = event.installState === 'installing' ? { ...state.installs, [event.serverId]: { phase: 'resolve', percent: null, message: 'Installation startet', log: [] } } : state.installs;
      return {
        ...state,
        installs,
        servers: patchServer(state.servers, event.serverId, { installState: event.installState as InstallState, installError: event.installError }),
      };
    }
    case 'install.progress': {
      const previous = state.installs[event.serverId];
      return {
        ...state,
        installs: {
          ...state.installs,
          [event.serverId]: { phase: event.phase, percent: event.percent, message: event.message, log: previous?.log ?? [] },
        },
      };
    }
    case 'install.log': {
      const previous = state.installs[event.serverId] ?? { phase: 'resolve', percent: null, message: '', log: [] };
      const log = [...previous.log, event.line];
      return {
        ...state,
        installs: {
          ...state.installs,
          [event.serverId]: { ...previous, log: log.length > MAX_INSTALL_LOG_LINES ? log.slice(-MAX_INSTALL_LOG_LINES) : log },
        },
      };
    }
    case 'mods.updates':
      return {
        ...state,
        modUpdates: { ...state.modUpdates, [event.serverId]: { ok: event.ok, count: event.count, projects: event.projects, error: event.error } },
      };
  }
}

export function liveReducer(state: LiveState, action: LiveAction): LiveState {
  switch (action.type) {
    case 'connection':
      return { ...state, connection: action.connection };
    case 'servers':
      return { ...state, servers: action.servers };
    case 'restart-needed':
      return {
        ...state,
        restartNeeded: action.needed ? { ...state.restartNeeded, [action.serverId]: true } : without(state.restartNeeded, action.serverId),
      };
    case 'message': {
      const message = action.message;
      switch (message.type) {
        case 'snapshot':
          return {
            ...state,
            snapshotSeen: true,
            statuses: Object.fromEntries(message.servers.map((entry) => [entry.serverId, entry.status])),
          };
        case 'pong':
        case 'error':
          return state;
        default:
          return reduceEvent(state, message);
      }
    }
  }
}

export function statusOf(state: LiveState, server: ServerView): RuntimeStatus {
  const live = state.statuses[server.id];
  if (live !== undefined) return live;
  return state.snapshotSeen ? offlineStatus() : server.status;
}

// Events after which the server list must be read again because the list itself changed.
export function needsRefetch(message: EventsServerMessage): boolean {
  if (message.type === 'server.changed') return message.reason !== 'deleted';
  if (message.type === 'install.state') return message.installState === 'installed' || message.installState === 'failed';
  return false;
}
