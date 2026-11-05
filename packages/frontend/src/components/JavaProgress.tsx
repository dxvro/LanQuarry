import type { ReactNode } from 'react';
import { useLive } from '../live/LiveProvider';
import { ProgressBar, Spinner } from './ui';

// Progress of the installation of a Java runtime, fed by the java.install events.
export function JavaProgress({ major, fallback }: { major: number; fallback?: { percent: number | null; message: string | null } }): ReactNode {
  const { state } = useLive();
  const live = state.javaInstalls[major];
  const running = live?.state === 'running' ? live : null;
  const percent = running?.percent ?? fallback?.percent ?? null;
  const message = running?.message ?? fallback?.message ?? null;
  if (running === null && fallback === undefined) return null;
  return (
    <div className="space-y-1.5" aria-live="polite">
      <p className="flex items-center gap-2">
        <Spinner className="text-accent" />
        <span className="font-medium">{message ?? `Java ${major} wird installiert ...`}</span>
        {percent === null ? null : <span className="num text-dim">{Math.round(percent)} %</span>}
      </p>
      <ProgressBar percent={percent} label={`Installation von Java ${major}`} />
    </div>
  );
}
