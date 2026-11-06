// Wire types of the self-update API. Pure types: the frontend imports them through contract.ts.
import type { SelfUpdateResult } from '../db/enums.js';

export type InstallMode = 'service' | 'portable' | 'dev';

export type UpdatePhase =
  | 'idle'
  | 'downloading'
  | 'verifying'
  | 'waiting-for-servers'
  | 'installing'
  | 'restarting'
  | 'done'
  | 'failed';

export interface LatestRelease {
  version: string;
  name: string | null;
  // release notes as plain text; the frontend renders a small safe subset of Markdown
  notes: string;
  publishedAt: string | null;
  htmlUrl: string;
  prerelease: boolean;
  // size of the installation file for this platform, when the release has one
  assetSizeBytes: number | null;
}

export interface UpdateProgress {
  message: string;
  percent: number | null;
  // seconds until running servers are stopped (countdown), otherwise null
  countdownRemaining: number | null;
}

export interface UpdateHistoryEntry {
  id: number;
  fromVersion: string;
  toVersion: string;
  result: SelfUpdateResult;
  message: string | null;
  stoppedServers: number;
  startedAt: number;
  finishedAt: number;
}

export interface SystemUpdateState {
  currentVersion: string;
  installMode: InstallMode;
  // German explanation for installMode portable/dev (why nothing is installed automatically)
  installModeNote: string | null;
  // false when UPDATE_CHECK=false switches update checks off completely
  checksEnabled: boolean;
  autoCheck: boolean;
  channel: 'stable' | 'prerelease';
  repo: string;
  countdownSeconds: number;
  checking: boolean;
  lastCheckAt: number | null;
  lastCheckError: string | null;
  latest: LatestRelease | null;
  updateAvailable: boolean;
  canApply: boolean;
  canApplyReason: string | null;
  phase: UpdatePhase;
  progress: UpdateProgress | null;
  // readable reason of the last failed update (phase failed) or null
  error: string | null;
  job: { id: string; fromVersion: string; toVersion: string; startedAt: number; servers: number } | null;
  history: UpdateHistoryEntry[];
}
