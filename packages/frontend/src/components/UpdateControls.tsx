import { Download } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { describeError } from '../lib/api';
import { updateApi } from '../lib/endpoints';
import { plural } from '../lib/format';
import { COUNTDOWN_MAX, PHASE_LABEL, STEPS, isRunning } from '../lib/update';
import type { SystemUpdateState } from '../lib/types';
import { useLive } from '../live/LiveProvider';
import { Dialog } from './Dialog';
import { Button, Notice, ProgressBar, Spinner, cx } from './ui';

export interface UpdateActions {
  busy: boolean;
  error: string | null;
  check: () => Promise<void>;
  apply: (countdownSeconds: number) => Promise<boolean>;
  cancel: () => Promise<void>;
  dismiss: () => Promise<void>;
  setAutoCheck: (value: boolean) => Promise<void>;
}

export function useUpdateActions(): UpdateActions {
  const { setUpdate } = useLive();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(task: () => Promise<SystemUpdateState>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      setUpdate(await task());
      return true;
    } catch (cause) {
      setError(describeError(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    error,
    check: async () => void (await run(() => updateApi.check())),
    apply: (countdownSeconds) => run(() => updateApi.apply(countdownSeconds)),
    cancel: async () => void (await run(() => updateApi.cancel())),
    dismiss: async () => void (await run(() => updateApi.dismiss())),
    setAutoCheck: async (value) => void (await run(() => updateApi.setAutoCheck(value))),
  };
}

function runningServerCount(statuses: Record<string, { state: string }>): number {
  return Object.values(statuses).filter((status) => ['online', 'starting', 'preparing'].includes(status.state)).length;
}

interface ApplyProps {
  state: SystemUpdateState;
  actions: UpdateActions;
  size?: 'md' | 'sm';
}

// The button and the confirmation: updating stops every running Minecraft server, so it is never a single click.
export function ApplyUpdate({ state, actions, size = 'md' }: ApplyProps): ReactNode {
  const { state: live } = useLive();
  const [open, setOpen] = useState(false);
  const [countdown, setCountdown] = useState(String(state.countdownSeconds));
  const countdownId = useId();
  const servers = runningServerCount(live.statuses);
  const seconds = Number(countdown);
  const valid = countdown.trim() !== '' && Number.isInteger(seconds) && seconds >= 0 && seconds <= COUNTDOWN_MAX;

  return (
    <>
      <Button variant="primary" size={size} icon={Download} disabled={!state.canApply || isRunning(state)} onClick={() => setOpen(true)}>
        Jetzt aktualisieren
      </Button>
      <Dialog
        open={open}
        title={`Auf Version ${state.latest?.version ?? ''} aktualisieren?`}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Abbrechen</Button>
            <Button
              variant="primary"
              disabled={!valid}
              loading={actions.busy}
              onClick={() => {
                void actions.apply(seconds).then((ok) => {
                  if (ok) setOpen(false);
                });
              }}
            >
              Jetzt aktualisieren
            </Button>
          </>
        }
      >
        <Notice tone="warn" title="Alle laufenden Minecraft-Server werden gestoppt">
          <p>
            {servers === 0
              ? 'Zurzeit läuft kein Server.'
              : `Zurzeit ${servers === 1 ? 'läuft' : 'laufen'} ${plural(servers, 'Server', 'Server')}.`}{' '}
            Die Spieler erhalten Chat-Warnungen mit Countdown, danach werden die Server sauber gestoppt (die Welt wird gespeichert) und nach dem Update automatisch wieder gestartet. CraftManager ist während der
            Installation kurz nicht erreichbar.
          </p>
        </Notice>
        <div className="space-y-1.5">
          <label htmlFor={countdownId} className="label block">
            Countdown für die Spieler (Sekunden)
          </label>
          <input
            id={countdownId}
            type="number"
            min={0}
            max={COUNTDOWN_MAX}
            inputMode="numeric"
            value={countdown}
            onChange={(event) => setCountdown(event.target.value)}
            aria-invalid={valid ? undefined : true}
            className="input w-32"
          />
          <p className="hint">0 stoppt die Server sofort. Höchstens {COUNTDOWN_MAX} Sekunden.</p>
        </div>
        {actions.error === null ? null : (
          <Notice tone="error">
            <p>{actions.error}</p>
          </Notice>
        )}
      </Dialog>
    </>
  );
}

export function UpdateProgress({ state, actions, compact = false }: { state: SystemUpdateState; actions?: UpdateActions; compact?: boolean }): ReactNode {
  const index = STEPS.indexOf(state.phase);
  const cancellable = state.phase === 'downloading' || state.phase === 'verifying' || (state.phase === 'waiting-for-servers' && state.progress?.countdownRemaining !== null);
  return (
    <div className="space-y-2" aria-live="polite">
      <p className="flex items-center gap-2 font-medium">
        <Spinner />
        {PHASE_LABEL[state.phase]}
      </p>
      {state.progress === null ? null : <p className="text-dim">{state.progress.message}</p>}
      {state.phase === 'downloading' ? <ProgressBar percent={state.progress?.percent ?? null} label="Download des Updates" /> : null}
      {compact ? null : (
        <ol className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {STEPS.map((step, position) => (
            <li key={step} className={cx(position < index ? 'text-ok' : position === index ? 'font-medium text-ink' : 'text-faint')} aria-current={position === index ? 'step' : undefined}>
              {position + 1}. {PHASE_LABEL[step]}
            </li>
          ))}
        </ol>
      )}
      {actions !== undefined && cancellable ? (
        <Button size="sm" loading={actions.busy} onClick={() => void actions.cancel()}>
          Update abbrechen
        </Button>
      ) : null}
    </div>
  );
}
