import type { SelfUpdateResult, SystemUpdateState, UpdatePhase } from './types';

export const PHASE_LABEL: Record<UpdatePhase, string> = {
  idle: 'Bereit',
  downloading: 'Update wird heruntergeladen',
  verifying: 'Signatur und Prüfsumme werden geprüft',
  'waiting-for-servers': 'Server werden gewarnt und gestoppt',
  installing: 'Update wird installiert',
  restarting: 'CraftManager startet neu',
  done: 'Update abgeschlossen',
  failed: 'Update fehlgeschlagen',
};

export const RESULT_LABEL: Record<SelfUpdateResult, string> = {
  success: 'Erfolgreich',
  failed: 'Fehlgeschlagen',
  rolled_back: 'Zurückgesetzt',
  cancelled: 'Abgebrochen',
};

// the steps in order, for the progress list
export const STEPS: UpdatePhase[] = ['downloading', 'verifying', 'waiting-for-servers', 'installing', 'restarting'];

export const isRunning = (state: SystemUpdateState): boolean => state.phase !== 'idle' && state.phase !== 'done' && state.phase !== 'failed';

// the banner is wanted whenever there is something to say
export function bannerKind(state: SystemUpdateState | null): 'available' | 'running' | 'done' | 'failed' | null {
  if (state === null) return null;
  if (isRunning(state)) return 'running';
  if (state.phase === 'done') return 'done';
  if (state.phase === 'failed') return 'failed';
  return state.updateAvailable ? 'available' : null;
}

export const COUNTDOWN_MAX = 600;
