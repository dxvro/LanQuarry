import type { ReactNode } from 'react';
import type { InstallState, Loader, RuntimeStatus, ServerState, ServerView } from '../lib/types';
import { cx } from './ui';

export const LOADER_LABEL: Record<Loader, string> = {
  vanilla: 'Vanilla',
  fabric: 'Fabric',
  neoforge: 'NeoForge',
  forge: 'Forge',
  paper: 'Paper',
};

export const STATE_LABEL: Record<ServerState, string> = {
  offline: 'Offline',
  preparing: 'Bereitet vor',
  starting: 'Startet',
  online: 'Online',
  stopping: 'Stoppt',
  crashed: 'Abgestürzt',
};

export const INSTALL_LABEL: Record<InstallState, string> = {
  pending: 'Wartet auf Installation',
  installing: 'Wird installiert',
  installed: 'Installiert',
  failed: 'Installation fehlgeschlagen',
};

type Look = { chip: string; led: string; pulse: boolean };

const STATE_LOOK: Record<ServerState, Look> = {
  offline: { chip: '', led: 'text-idle', pulse: false },
  preparing: { chip: 'chip-accent', led: 'text-accent', pulse: true },
  starting: { chip: 'chip-warn', led: 'text-warn', pulse: true },
  online: { chip: 'chip-ok', led: 'text-ok', pulse: false },
  stopping: { chip: 'chip-busy', led: 'text-busy', pulse: true },
  crashed: { chip: 'chip-bad', led: 'text-bad', pulse: false },
};

const INSTALL_LOOK: Record<Exclude<InstallState, 'installed'>, Look> = {
  pending: { chip: 'chip-accent', led: 'text-accent', pulse: true },
  installing: { chip: 'chip-accent', led: 'text-accent', pulse: true },
  failed: { chip: 'chip-bad', led: 'text-bad', pulse: false },
};

// Install problems take precedence over the runtime state: a server that is not installed cannot be anything else.
export function displayState(server: Pick<ServerView, 'installState'>, status: Pick<RuntimeStatus, 'state'>): { label: string; look: Look } {
  if (server.installState !== 'installed') return { label: INSTALL_LABEL[server.installState], look: INSTALL_LOOK[server.installState] };
  return { label: STATE_LABEL[status.state], look: STATE_LOOK[status.state] };
}

export function StatusChip({ server, status }: { server: Pick<ServerView, 'installState'>; status: Pick<RuntimeStatus, 'state'> }): ReactNode {
  const { label, look } = displayState(server, status);
  return (
    <span className={cx('chip', look.chip)}>
      <span aria-hidden className={cx('led', look.led, look.pulse && 'led-pulse')} />
      {label}
    </span>
  );
}

export function StatusLed({ server, status }: { server: Pick<ServerView, 'installState'>; status: Pick<RuntimeStatus, 'state'> }): ReactNode {
  const { look } = displayState(server, status);
  return <span aria-hidden className={cx('led', look.led, look.pulse && 'led-pulse')} />;
}

const SEGMENTS = 12;

// Twelve-segment bar; the colour steps with the load so a hot server stands out in a long list.
export function Meter({ value, label, valueText }: { value: number | null; label: string; valueText: string }): ReactNode {
  const ratio = value === null ? 0 : Math.min(1, Math.max(0, value));
  const lit = Math.round(ratio * SEGMENTS);
  const color = ratio >= 0.9 ? 'var(--color-bad)' : ratio >= 0.7 ? 'var(--color-warn)' : 'var(--color-accent)';
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} aria-valuetext={valueText} className="seg-meter">
      {Array.from({ length: SEGMENTS }, (_, index) => (
        <i key={index} data-on={index < lit} style={{ '--seg': color } as React.CSSProperties} />
      ))}
    </div>
  );
}
