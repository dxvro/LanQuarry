export const SERVER_STATES = ['offline', 'starting', 'online', 'stopping', 'crashed'] as const;
export type ServerState = (typeof SERVER_STATES)[number];

export interface RuntimeStatus {
  state: ServerState;
  pid: number | null;
  startedAt: number | null;
  exitCode: number | null;
  message: string | null;
  players: string[];
  port: number | null;
  cpuPercent: number | null;
  rssBytes: number | null;
}

export type ConsoleStream = 'stdout' | 'stderr' | 'system' | 'input';

export interface ConsoleLine {
  seq: number;
  time: number;
  stream: ConsoleStream;
  text: string;
}

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
