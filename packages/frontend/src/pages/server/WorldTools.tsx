import { Download, FileDown, Replace } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Dialog } from '../../components/Dialog';
import { Button, ErrorNotice, Notice, Section, Spinner, Toggle } from '../../components/ui';
import { AnalysisFacts, NoticeList, UploadBox, useImportUpload } from '../../components/WorldImport';
import { isAbort } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import type { BackupView, RuntimeStatus, ServerView } from '../../lib/types';
import { allAcknowledged, hasBlocker, waitForExport, waitForImport, worldApi, type ExportJobView, type ExportOptions, type ImportJobView, type ImportReview } from '../../lib/world';

const MODS_OPTIONS: Array<{ id: ExportOptions['mods']; label: string; hint: string }> = [
  { id: 'none', label: 'Ohne Mods', hint: 'Nur die Welt.' },
  { id: 'manifest', label: 'Mod-Liste (Manifest)', hint: 'Namen, Versionen und Prüfsummen; beim Import werden die Mods bei Modrinth gesucht.' },
  { id: 'jars', label: 'Mod-Liste und Mod-Dateien', hint: 'Die Jar-Dateien liegen im Archiv; das Archiv wird größer.' },
];

const runningStates: ReadonlySet<string> = new Set(['preparing', 'starting', 'online', 'stopping']);

export function ExportDialog({ server, backup, open, onClose }: { server: ServerView; backup: BackupView | null; open: boolean; onClose: () => void }): ReactNode {
  const supportsMods = server.loader !== 'vanilla';
  const [format, setFormat] = useState<ExportOptions['format']>('zip');
  const [mods, setMods] = useState<ExportOptions['mods']>('none');
  const [includeConfig, setIncludeConfig] = useState(false);
  const [job, setJob] = useState<ExportJobView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [starting, setStarting] = useState(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) {
      controller.current?.abort();
      setJob(null);
      setError(null);
      setStarting(false);
    }
  }, [open]);
  useEffect(() => () => controller.current?.abort(), []);

  const running = job?.status === 'running';
  const start = async (): Promise<void> => {
    setStarting(true);
    setError(null);
    setJob(null);
    controller.current?.abort();
    const own = new AbortController();
    controller.current = own;
    try {
      const started = backup === null ? await worldApi.startExport(server.id, { format, mods: supportsMods ? mods : 'none', includeConfig }) : await worldApi.startBackupExport(server.id, backup.id, format);
      setJob(started);
      await waitForExport(started.id, setJob, own.signal);
    } catch (cause) {
      if (!isAbort(cause)) setError(cause);
    } finally {
      setStarting(false);
    }
  };

  const title = backup === null ? 'Welt exportieren' : 'Backup als Welt exportieren';
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{job?.status === 'ready' ? 'Schließen' : 'Abbrechen'}</Button>
          {job?.status === 'ready' ? (
            <a href={worldApi.exportDownloadUrl(job.id)} download className="btn btn-primary no-underline">
              <Download aria-hidden className="size-4 shrink-0" />
              Herunterladen
            </a>
          ) : (
            <Button variant="primary" icon={FileDown} loading={starting || running} onClick={() => void start()}>
              Export erstellen
            </Button>
          )}
        </>
      }
    >
      {backup !== null ? (
        <Notice tone="info">Das Archiv enthält die Welt aus diesem Backup (mit Nether und End), ohne Mods.</Notice>
      ) : (
        <p className="text-dim">
          Das Archiv enthält die Welt mit Nether und End und eine Beschreibung (craftmanager-export.json). Es lässt sich in CraftManager oder, entpackt, auf anderen Servern verwenden.
          {runningStates.has(server.status.state) ? ' Der Server läuft weiter: Das Speichern wird dafür kurz angehalten und danach wieder eingeschaltet.' : ''}
        </p>
      )}
      <fieldset className="space-y-2" disabled={starting || running || job?.status === 'ready'}>
        <legend className="label mb-1.5">Format</legend>
        {(
          [
            ['zip', 'ZIP (empfohlen)', 'Lässt sich unter Windows direkt öffnen.'],
            ['tar.gz', 'tar.gz', 'Üblich unter Linux.'],
          ] as const
        ).map(([id, label, hint]) => (
          <label key={id} className="flex cursor-pointer items-start gap-3">
            <input type="radio" name="export-format" checked={format === id} onChange={() => setFormat(id)} className="mt-0.5 size-5 shrink-0 accent-[var(--color-accent)]" />
            <span>
              {label} <span className="hint block">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {backup !== null ? null : (
        <>
          {supportsMods ? (
            <fieldset className="space-y-2" disabled={starting || running || job?.status === 'ready'}>
              <legend className="label mb-1.5">Mods</legend>
              {MODS_OPTIONS.map((option) => (
                <label key={option.id} className="flex cursor-pointer items-start gap-3">
                  <input type="radio" name="export-mods" checked={mods === option.id} onChange={() => setMods(option.id)} className="mt-0.5 size-5 shrink-0 accent-[var(--color-accent)]" />
                  <span>
                    {option.label} <span className="hint block">{option.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}
          <Toggle checked={includeConfig} onChange={setIncludeConfig} disabled={starting || running || job?.status === 'ready'} label="Konfiguration mitnehmen" description="server.properties, ops, whitelist, Sperrlisten und die Ordner config und defaultconfigs." />
        </>
      )}
      {running ? (
        <p role="status" className="flex items-center gap-2 text-dim">
          <Spinner />
          Das Archiv wird erstellt …
        </p>
      ) : null}
      {job?.status === 'ready' ? (
        <Notice tone={job.warnings.length > 0 ? 'warn' : 'success'} title="Der Export ist fertig">
          <p>
            {job.fileName}, {job.sizeBytes === null ? '' : formatBytes(job.sizeBytes)}. Die Datei steht etwa 30 Minuten zum Herunterladen bereit.
          </p>
          {job.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </Notice>
      ) : null}
      {job?.status === 'failed' ? <Notice tone="error" title="Der Export ist fehlgeschlagen">{job.error}</Notice> : null}
      {error === null ? null : <ErrorNotice error={error} title="Der Export konnte nicht gestartet werden" />}
    </Dialog>
  );
}

export function ReplaceDialog({ server, status, open, onClose, onDone }: { server: ServerView; status: RuntimeStatus; open: boolean; onClose: () => void; onDone: () => void }): ReactNode {
  const upload = useImportUpload(server.id);
  const stopped = !runningStates.has(status.state);
  const [review, setReview] = useState<ImportReview | null>(null);
  const [reviewError, setReviewError] = useState<unknown>(null);
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<ImportJobView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const jobId = upload.job?.status === 'staged' ? upload.job.id : null;

  useEffect(() => {
    if (!open) {
      upload.reset();
      setReview(null);
      setReviewError(null);
      setAcknowledged([]);
      setResult(null);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (jobId === null) return;
    const controller = new AbortController();
    setReviewError(null);
    worldApi
      .review(jobId, null, controller.signal)
      .then(setReview)
      .catch((cause: unknown) => {
        if (!isAbort(cause)) setReviewError(cause);
      });
    return () => controller.abort();
  }, [jobId]);

  const analysis = upload.job?.status === 'staged' ? upload.job.analysis : null;
  const notices = [...(analysis?.notices ?? []), ...(review?.notices ?? [])].filter((notice, index, all) => all.findIndex((other) => other.code === notice.code) === index);
  const canApply = jobId !== null && review !== null && stopped && !hasBlocker(notices) && allAcknowledged(notices, acknowledged) && result === null;

  const apply = async (): Promise<void> => {
    if (jobId === null) return;
    setApplying(true);
    setError(null);
    try {
      await worldApi.replaceWorld(server.id, jobId, acknowledged);
      const finished = await waitForImport(jobId, setResult);
      if (finished.status === 'done') onDone();
    } catch (cause) {
      if (!isAbort(cause)) setError(cause);
    } finally {
      setApplying(false);
    }
  };

  const done = result?.status === 'done';
  return (
    <Dialog
      open={open}
      title="Welt ersetzen"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={applying}>
            {done ? 'Schließen' : 'Abbrechen'}
          </Button>
          {done ? null : (
            <Button variant="danger-solid" icon={Replace} loading={applying} disabled={!canApply} onClick={() => void apply()}>
              Welt ersetzen
            </Button>
          )}
        </>
      }
    >
      {stopped ? null : <Notice tone="error">Der Server läuft. Zum Ersetzen der Welt muss er zuerst gestoppt werden.</Notice>}
      {done ? (
        <Notice tone={result?.result?.warnings.length ? 'warn' : 'success'} title="Die Welt wurde ersetzt">
          <p>Die bisherige Welt liegt als Sicherheits-Backup unter „Backups“. Übernommen: {result?.result?.folders.join(', ')}.</p>
          {result?.result?.warnings.map((warning) => <p key={warning}>{warning}</p>)}
        </Notice>
      ) : (
        <>
          <p className="text-dim">Lade ein Archiv mit der neuen Welt hoch. Vorher wird automatisch ein Sicherheits-Backup der jetzigen Welt angelegt; schlägt etwas fehl, bleibt die alte Welt erhalten. Mods werden dabei nicht verändert.</p>
          <UploadBox upload={upload} disabled={!stopped || applying} />
          {analysis === null ? null : (
            <>
              <AnalysisFacts analysis={analysis} />
              {review === null && reviewError === null ? <p role="status" className="flex items-center gap-2 text-dim"><Spinner />Hinweise werden ermittelt …</p> : null}
              {reviewError === null ? null : <ErrorNotice error={reviewError} />}
              <NoticeList notices={notices} acknowledged={acknowledged} onToggle={(code, checked) => setAcknowledged((current) => (checked ? [...current, code] : current.filter((entry) => entry !== code)))} />
            </>
          )}
          {result?.status === 'failed' ? <Notice tone="error" title="Die Welt wurde nicht ersetzt">{result.error}</Notice> : null}
          {error === null ? null : <ErrorNotice error={error} title="Die Welt konnte nicht ersetzt werden" />}
        </>
      )}
    </Dialog>
  );
}

export function WorldTools({ server, status, exportBackup, onCloseBackupExport }: { server: ServerView; status: RuntimeStatus; exportBackup: BackupView | null; onCloseBackupExport: () => void }): ReactNode {
  const [exporting, setExporting] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [replacedAt, setReplacedAt] = useState<number | null>(null);
  const stopped = !runningStates.has(status.state);
  return (
    <Section
      title="Welt importieren und exportieren"
      description="Die Welt als Archiv sichern oder weitergeben, oder eine vorhandene Welt (Einzelspieler, anderer Server, CraftManager-Export) an die Stelle der jetzigen setzen."
      action={
        <div className="flex flex-wrap gap-2">
          <Button icon={FileDown} onClick={() => setExporting(true)}>
            Welt exportieren
          </Button>
          <Button icon={Replace} disabled={!stopped} title={stopped ? undefined : 'Nur bei gestopptem Server möglich'} onClick={() => setReplacing(true)}>
            Welt ersetzen
          </Button>
        </div>
      }
    >
      {replacedAt === null ? null : <Notice tone="success">Die Welt wurde ersetzt.</Notice>}
      <ExportDialog server={server} backup={null} open={exporting} onClose={() => setExporting(false)} />
      <ExportDialog server={server} backup={exportBackup} open={exportBackup !== null} onClose={onCloseBackupExport} />
      <ReplaceDialog server={server} status={status} open={replacing} onClose={() => setReplacing(false)} onDone={() => setReplacedAt(Date.now())} />
    </Section>
  );
}
