import { Download, RotateCw } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLive } from '../live/LiveProvider';
import { serversApi } from '../lib/endpoints';
import type { ServerView } from '../lib/types';
import { Button, ErrorNotice, Notice, Spinner } from './ui';

const PHASE_LABEL: Record<string, string> = {
  resolve: 'Version wird ermittelt',
  download: 'Dateien werden heruntergeladen',
  install: 'Installer läuft',
  done: 'Fertig',
};

function ProgressBar({ percent }: { percent: number | null }): ReactNode {
  return (
    <div
      role="progressbar"
      aria-label="Installationsfortschritt"
      aria-valuemin={0}
      aria-valuemax={100}
      {...(percent === null ? {} : { 'aria-valuenow': Math.round(percent) })}
      className="relative h-2 overflow-hidden rounded-full bg-raised"
    >
      {percent === null ? (
        <span className="absolute inset-y-0 left-0 w-1/3 animate-slide rounded-full bg-accent" />
      ) : (
        <span className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      )}
    </div>
  );
}

function InstallLog({ lines }: { lines: string[] }): ReactNode {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [lines.length]);
  return (
    <pre
      ref={ref}
      tabIndex={0}
      role="log"
      aria-label="Installationsprotokoll"
      className="console-body max-h-64 min-h-24 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-canvas p-3 text-dim"
    >
      {lines.length === 0 ? 'Noch keine Ausgabe …' : lines.join('\n')}
    </pre>
  );
}

interface InstallPanelProps {
  server: ServerView;
  onDone?: () => void;
}

// Progress, log and retry of an installation, fed by the event stream.
export function InstallPanel({ server, onDone }: InstallPanelProps): ReactNode {
  const { state, refresh } = useLive();
  const progress = state.installs[server.id];
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<unknown>(null);

  const retry = async (): Promise<void> => {
    setRetrying(true);
    setRetryError(null);
    try {
      await serversApi.install(server.id);
      await refresh();
    } catch (cause) {
      setRetryError(cause);
    } finally {
      setRetrying(false);
    }
  };

  if (server.installState === 'installed') {
    return (
      <Notice
        tone="success"
        title="Installation abgeschlossen"
        {...(onDone === undefined ? {} : { action: <Button size="sm" variant="primary" onClick={onDone}>Zum Server</Button> })}
      >
        <p>Der Server ist bereit. Vor dem ersten Start muss die Minecraft-EULA akzeptiert sein.</p>
      </Notice>
    );
  }

  if (server.installState === 'failed') {
    return (
      <div className="space-y-3">
        <Notice tone="error" title="Die Installation ist fehlgeschlagen">
          <p>Der vollständige Fehlertext:</p>
        </Notice>
        <pre tabIndex={0} aria-label="Fehlertext der Installation" className="console-body max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-bad/40 bg-canvas p-3 text-bad">
          {server.installError ?? 'Es wurde keine Fehlermeldung gespeichert.'}
        </pre>
        {progress !== undefined && progress.log.length > 0 ? <InstallLog lines={progress.log} /> : null}
        {retryError === null ? null : <ErrorNotice error={retryError} />}
        <Button variant="primary" icon={RotateCw} loading={retrying} onClick={() => void retry()}>
          Installation erneut starten
        </Button>
      </div>
    );
  }

  const pending = server.installState === 'pending';
  const phase = progress === undefined ? (pending ? 'Wartet auf den Start der Installation' : 'Installation läuft') : (PHASE_LABEL[progress.phase] ?? progress.phase);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {pending ? <Download aria-hidden className="size-4 text-accent" /> : <Spinner className="text-accent" />}
        <p className="font-medium" aria-live="polite">
          {phase}
          {progress?.percent == null ? '' : ` (${Math.round(progress.percent)} %)`}
        </p>
      </div>
      <ProgressBar percent={progress?.percent ?? null} />
      {progress === undefined || progress.message === '' ? null : <p className="hint">{progress.message}</p>}
      <InstallLog lines={progress?.log ?? []} />
      <p className="hint">Das Protokoll zeigt nur Ausgaben, die seit dem Öffnen dieser Seite eingetroffen sind.</p>
      {pending ? (
        <>
          {retryError === null ? null : <ErrorNotice error={retryError} />}
          <Button icon={RotateCw} loading={retrying} onClick={() => void retry()}>
            Installation starten
          </Button>
        </>
      ) : null}
    </div>
  );
}

