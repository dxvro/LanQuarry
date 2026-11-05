import { Play, RotateCw, Skull, Square } from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';
import { ApiError } from '../lib/api';
import { serversApi } from '../lib/endpoints';
import { serverPath, Link } from '../lib/router';
import type { RuntimeStatus, ServerView } from '../lib/types';
import { Dialog } from './Dialog';
import { Button, ErrorNotice, Notice } from './ui';

export type ServerAction = 'start' | 'stop' | 'restart' | 'kill';

export interface ActionState {
  busy: ServerAction | null;
  error: unknown;
  warnings: string[];
  run: (action: ServerAction) => Promise<void>;
  clear: () => void;
}

export function useServerActions(serverId: string): ActionState {
  const [busy, setBusy] = useState<ServerAction | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const run = useCallback(
    async (action: ServerAction): Promise<void> => {
      setBusy(action);
      setError(null);
      setWarnings([]);
      try {
        const result: Awaited<ReturnType<(typeof serversApi)[ServerAction]>> = await serversApi[action](serverId);
        setWarnings('warnings' in result ? (result.warnings as string[]) : []);
      } catch (cause) {
        setError(cause);
      } finally {
        setBusy(null);
      }
    },
    [serverId],
  );
  const clear = useCallback(() => {
    setError(null);
    setWarnings([]);
  }, []);
  return { busy, error, warnings, run, clear };
}

interface ActionBarProps {
  server: Pick<ServerView, 'id' | 'name' | 'installState'>;
  status: Pick<RuntimeStatus, 'state'>;
  actions: ActionState;
  compact?: boolean;
}

export function ActionBar({ server, status, actions, compact = false }: ActionBarProps): ReactNode {
  const [confirmKill, setConfirmKill] = useState(false);
  const { busy, run } = actions;
  const { state } = status;
  const installed = server.installState === 'installed';
  const active = state === 'starting' || state === 'online' || state === 'stopping';
  const size = compact ? 'sm' : 'md';

  return (
    <div className="flex flex-wrap items-center gap-2">
      {active ? null : (
        <Button variant="primary" size={size} icon={Play} loading={busy === 'start'} disabled={!installed || busy !== null} onClick={() => void run('start')}>
          Starten
        </Button>
      )}
      {active ? (
        <>
          <Button size={size} icon={Square} loading={busy === 'stop'} disabled={state === 'stopping' || busy !== null} onClick={() => void run('stop')}>
            Stoppen
          </Button>
          <Button size={size} icon={RotateCw} loading={busy === 'restart'} disabled={state === 'stopping' || busy !== null} onClick={() => void run('restart')}>
            Neustart
          </Button>
          <Button variant="danger" size={size} icon={Skull} title="Prozess sofort beenden" loading={busy === 'kill'} disabled={busy !== null} onClick={() => setConfirmKill(true)}>
            Erzwingen
          </Button>
        </>
      ) : null}
      <Dialog
        open={confirmKill}
        title={`„${server.name}“ sofort beenden?`}
        onClose={() => setConfirmKill(false)}
        footer={
          <>
            <Button onClick={() => setConfirmKill(false)}>Abbrechen</Button>
            <Button
              variant="danger-solid"
              icon={Skull}
              onClick={() => {
                setConfirmKill(false);
                void run('kill');
              }}
            >
              Prozess beenden
            </Button>
          </>
        }
      >
        <p>Der Prozess wird ohne Speichern beendet. Spielstände der letzten Minuten können verloren gehen. Besser ist „Stoppen“, das die Welt sauber speichert.</p>
      </Dialog>
    </div>
  );
}

// Hints that turn the most common start failures into the next step.
function hintFor(error: unknown, serverId: string): ReactNode {
  if (!(error instanceof ApiError)) return undefined;
  if (error.code === 'EULA_NOT_ACCEPTED') {
    return (
      <Link to={serverPath(serverId, 'config')} className="link-btn font-medium">
        Zur Konfiguration (EULA)
      </Link>
    );
  }
  if (error.code === 'JAVA_NOT_FOUND' || error.code === 'JAVA_VERSION_INCOMPATIBLE') {
    return (
      <Link to={serverPath(serverId, 'config')} className="link-btn font-medium">
        Java-Laufzeit einstellen
      </Link>
    );
  }
  if (error.code === 'PORT_IN_USE') {
    return (
      <Link to={serverPath(serverId, 'config')} className="link-btn font-medium">
        Port ändern
      </Link>
    );
  }
  return undefined;
}

export function ActionFeedback({ serverId, actions }: { serverId: string; actions: ActionState }): ReactNode {
  const { error, warnings, clear } = actions;
  if (error === null && warnings.length === 0) return null;
  const hint = hintFor(error, serverId);
  return (
    <div className="space-y-2">
      {error === null ? null : (
        <ErrorNotice error={error} {...(hint === undefined ? {} : { action: hint })} />
      )}
      {warnings.length === 0 ? null : (
        <Notice tone="warn" title="Hinweise zum Start">
          <ul className="list-disc pl-5">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Notice>
      )}
      <Button variant="ghost" size="sm" onClick={clear}>
        Meldung ausblenden
      </Button>
    </div>
  );
}
