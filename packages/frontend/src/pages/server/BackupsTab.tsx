import { Archive, Download, FileDown, HardDrive, History, RotateCcw, Save, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Dialog } from '../../components/Dialog';
import { Button, EmptyState, ErrorNotice, Field, LoadingBlock, Notice, Section, Spinner, Toggle, cx } from '../../components/ui';
import { backupsApi } from '../../lib/endpoints';
import { formatBytes, formatDateTime, plural } from '../../lib/format';
import type { BackupKind, BackupSchedule, BackupStatus, BackupView, RestoreView, RuntimeStatus, ServerView } from '../../lib/types';
import { useQuery } from '../../lib/useQuery';
import { useLive } from '../../live/LiveProvider';
import { WorldTools } from './WorldTools';

const KIND_LABEL: Record<BackupKind, { text: string; chip: string }> = {
  manual: { text: 'Manuell', chip: 'chip-accent' },
  auto: { text: 'Automatisch', chip: '' },
  safety: { text: 'Sicherheit', chip: 'chip-warn' },
};

const STATUS_LABEL: Record<BackupStatus, { text: string; chip: string }> = {
  running: { text: 'Läuft …', chip: 'chip-busy' },
  ok: { text: 'Fertig', chip: 'chip-ok' },
  failed: { text: 'Fehlgeschlagen', chip: 'chip-bad' },
};

const INTERVAL_PRESETS = [1, 2, 3, 6, 12, 24, 48, 168];

export const intervalLabel = (hours: number): string => (hours === 168 ? 'Jede Woche' : hours === 24 ? 'Jeden Tag' : hours === 1 ? 'Jede Stunde' : `Alle ${hours} Stunden`);

// Parses the "keep last N" field; null while it is not a whole number between 1 and 100
export function parseKeepLast(text: string): number | null {
  if (!/^\d{1,3}$/.test(text.trim())) return null;
  const value = Number(text.trim());
  return value >= 1 && value <= 100 ? value : null;
}

function BackupRow({ serverId, backup, locked, onRestore, onDelete, onExport }: { serverId: string; backup: BackupView; locked: boolean; onRestore: () => void; onDelete: () => void; onExport: () => void }): ReactNode {
  const kind = KIND_LABEL[backup.kind];
  const status = STATUS_LABEL[backup.status];
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" data-testid="backup-row">
      <div className="min-w-0 flex-1 basis-60 space-y-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="num font-medium">{formatDateTime(backup.createdAt)}</span>
          <span className={cx('chip', kind.chip)}>{kind.text}</span>
          <span className={cx('chip', status.chip)}>
            {backup.status === 'running' ? <Spinner className="size-3" /> : null}
            {status.text}
          </span>
          {backup.includesConfig ? <span className="chip">mit Konfiguration</span> : null}
        </p>
        <p className="num text-sm text-dim">
          {backup.status === 'ok' ? formatBytes(backup.sizeBytes) : backup.status === 'running' ? 'wird erstellt' : '–'}
          {backup.worlds.length === 0 ? '' : ` · ${backup.worlds.join(', ')}`}
        </p>
        {backup.error === null ? null : <p className="text-sm text-bad">{backup.error}</p>}
        {backup.note === null ? null : <p className="hint">{backup.note}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {backup.status === 'ok' ? (
          <>
            <a href={backupsApi.downloadUrl(serverId, backup.id)} download className="btn btn-sm no-underline" aria-label={`Backup vom ${formatDateTime(backup.createdAt)} herunterladen`}>
              <Download aria-hidden className="size-4 shrink-0" />
              Herunterladen
            </a>
            <Button size="sm" icon={FileDown} title="Die Welt dieses Backups als ZIP-Archiv exportieren" onClick={onExport}>
              Als Welt exportieren
            </Button>
            <Button size="sm" icon={RotateCcw} disabled={locked} title={locked ? 'Nur bei gestopptem Server möglich' : 'Diesen Stand wiederherstellen'} onClick={onRestore}>
              Wiederherstellen
            </Button>
          </>
        ) : null}
        <Button size="sm" variant="danger" icon={Trash2} disabled={backup.status === 'running'} onClick={onDelete}>
          Löschen
        </Button>
      </div>
    </li>
  );
}

function ScheduleSection({ server, schedule, onSaved }: { server: ServerView; schedule: BackupSchedule; onSaved: () => void }): ReactNode {
  const [interval, setIntervalHours] = useState<number | null>(schedule.intervalHours);
  const [keepText, setKeepText] = useState(String(schedule.keepLast));
  const [includeConfig, setIncludeConfig] = useState(schedule.includeConfig);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    setIntervalHours(schedule.intervalHours);
    setKeepText(String(schedule.keepLast));
    setIncludeConfig(schedule.includeConfig);
  }, [schedule.intervalHours, schedule.keepLast, schedule.includeConfig]);

  const keep = parseKeepLast(keepText);
  const presets = interval !== null && !INTERVAL_PRESETS.includes(interval) ? [...INTERVAL_PRESETS, interval].sort((a, b) => a - b) : INTERVAL_PRESETS;
  const patch: Partial<BackupSchedule> = {};
  if (interval !== schedule.intervalHours) patch.intervalHours = interval;
  if (keep !== null && keep !== schedule.keepLast) patch.keepLast = keep;
  if (includeConfig !== schedule.includeConfig) patch.includeConfig = includeConfig;
  const dirty = Object.keys(patch).length > 0;

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await backupsApi.setSchedule(server.id, patch);
      setSaved(true);
      onSaved();
    } catch (cause) {
      setError(cause);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="Zeitplan und Aufbewahrung" description="Automatische Backups laufen auch bei laufendem Server. Handgemachte und Sicherheits-Backups werden nie automatisch gelöscht.">
      <form
        className="space-y-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Automatisches Backup">
            {(props) => (
              <select
                {...props}
                className="input"
                value={interval === null ? '' : String(interval)}
                onChange={(event) => {
                  setIntervalHours(event.target.value === '' ? null : Number(event.target.value));
                  setSaved(false);
                }}
              >
                <option value="">Aus</option>
                {presets.map((hours) => (
                  <option key={hours} value={hours}>
                    {intervalLabel(hours)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Automatische Backups behalten" hint="Die ältesten darüber hinaus werden gelöscht." error={keep === null ? 'Bitte eine Zahl von 1 bis 100 eingeben.' : undefined}>
            {(props) => (
              <input
                {...props}
                className="input num"
                inputMode="numeric"
                value={keepText}
                onChange={(event) => {
                  setKeepText(event.target.value);
                  setSaved(false);
                }}
              />
            )}
          </Field>
        </div>
        <Toggle
          checked={includeConfig}
          onChange={(value) => {
            setIncludeConfig(value);
            setSaved(false);
          }}
          label="Konfigurationsdateien mitsichern"
          description="server.properties, ops.json, whitelist.json, banned-*.json, bukkit/spigot/paper.yml sowie die Ordner config und defaultconfigs."
        />
        {error === null ? null : <ErrorNotice error={error} title="Der Zeitplan wurde nicht gespeichert" />}
        {saved ? <Notice tone="success">Gespeichert.</Notice> : null}
        <Button type="submit" variant="primary" icon={Save} loading={saving} disabled={!dirty || keep === null}>
          Zeitplan speichern
        </Button>
      </form>
    </Section>
  );
}

export function BackupsTab({ server, status }: { server: ServerView; status: RuntimeStatus }): ReactNode {
  const { state } = useLive();
  const tick = state.backupTicks[server.id] ?? 0;
  const list = useQuery((signal) => backupsApi.list(server.id, signal), [server.id, tick]);
  const [includeConfig, setIncludeConfig] = useState<boolean | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [restoreTarget, setRestoreTarget] = useState<BackupView | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<unknown>(null);
  const [restored, setRestored] = useState<RestoreView | null>(null);
  const [exportTarget, setExportTarget] = useState<BackupView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BackupView | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<unknown>(null);

  const data = list.data;
  const backups = data?.backups ?? [];
  const running = status.state === 'preparing' || status.state === 'starting' || status.state === 'online' || status.state === 'stopping';
  const writing = data?.running === true || backups.some((backup) => backup.status === 'running');
  const withConfig = includeConfig ?? data?.schedule.includeConfig ?? false;
  const busyServer = status.state === 'preparing' || status.state === 'starting' || status.state === 'stopping';

  const create = async (): Promise<void> => {
    setCreating(true);
    setError(null);
    try {
      await backupsApi.create(server.id, withConfig);
      list.reload();
    } catch (cause) {
      setError(cause);
    } finally {
      setCreating(false);
    }
  };

  const restore = async (): Promise<void> => {
    if (restoreTarget === null) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      setRestored(await backupsApi.restore(server.id, restoreTarget.id));
      setRestoreTarget(null);
      list.reload();
    } catch (cause) {
      setRestoreError(cause);
    } finally {
      setRestoring(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (deleteTarget === null) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await backupsApi.remove(server.id, deleteTarget.id);
      setDeleteTarget(null);
      list.reload();
    } catch (cause) {
      setDeleteError(cause);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Section
        title="Backups der Welt"
        description={
          running
            ? 'Der Server läuft: Das Speichern wird kurz angehalten (save-off, save-all flush), die Welt gesichert und das Speichern danach immer wieder eingeschaltet (save-on). Der Server läuft währenddessen weiter.'
            : 'Gesichert werden die Welt samt Nether und End. Die Archive liegen im Datenordner und lassen sich herunterladen.'
        }
        action={
          <Button variant="primary" icon={Archive} loading={creating || writing} disabled={busyServer} title={busyServer ? 'Der Server startet oder stoppt gerade' : undefined} onClick={() => void create()}>
            Backup erstellen
          </Button>
        }
      >
        <label className="mb-3 flex cursor-pointer items-start gap-3">
          <input type="checkbox" checked={withConfig} onChange={(event) => setIncludeConfig(event.target.checked)} className="mt-1 size-5 shrink-0 accent-[var(--color-accent)]" />
          <span>
            Konfigurationsdateien mitsichern <span className="hint block">server.properties, Listen der Spieler und der Ordner config.</span>
          </span>
        </label>
        {error === null ? null : <ErrorNotice error={error} title="Das Backup konnte nicht gestartet werden" />}
        {data === undefined ? null : (
          <p className="num hint flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <History aria-hidden className="size-3.5" />
              {plural(backups.length, 'Backup', 'Backups')}, zusammen {formatBytes(data.totalBytes)}
            </span>
            {data.freeBytes === null ? null : (
              <span className="inline-flex items-center gap-1.5">
                <HardDrive aria-hidden className="size-3.5" />
                {formatBytes(data.freeBytes)} frei
              </span>
            )}
          </p>
        )}
      </Section>

      {restored === null ? null : (
        <Notice
          tone={restored.warnings.length > 0 ? 'warn' : 'success'}
          title="Das Backup wurde wiederhergestellt"
          action={<Button size="sm" variant="ghost" onClick={() => setRestored(null)}>Ausblenden</Button>}
        >
          <p>
            Vorher wurde {restored.safety === null ? 'kein Sicherheits-Backup nötig (es gab noch keine Welt)' : 'der bisherige Stand als Sicherheits-Backup abgelegt'}.
          </p>
          {restored.warnings.length === 0 ? null : (
            <ul className="mt-1 list-disc pl-5">
              {restored.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}

      {list.loading && data === undefined ? (
        <LoadingBlock label="Backups werden geladen …" />
      ) : list.error !== null && data === undefined ? (
        <ErrorNotice error={list.error} title="Die Backups konnten nicht geladen werden" action={<Button size="sm" onClick={list.reload}>Erneut versuchen</Button>} />
      ) : backups.length === 0 ? (
        <EmptyState icon={Archive} title="Noch keine Backups">
          <p>Ein Backup sichert die Welt, bevor etwas schiefgeht. Mit einem Zeitplan entstehen sie von selbst.</p>
        </EmptyState>
      ) : (
        <section aria-label="Liste der Backups" className="panel overflow-hidden">
          <ul className="divide-y divide-line">
            {backups.map((backup) => (
              <BackupRow
                key={backup.id}
                serverId={server.id}
                backup={backup}
                locked={running}
                onRestore={() => {
                  setRestoreError(null);
                  setRestoreTarget(backup);
                }}
                onDelete={() => {
                  setDeleteError(null);
                  setDeleteTarget(backup);
                }}
                onExport={() => setExportTarget(backup)}
              />
            ))}
          </ul>
        </section>
      )}

      <WorldTools server={server} status={status} exportBackup={exportTarget} onCloseBackupExport={() => setExportTarget(null)} />

      {data === undefined ? null : <ScheduleSection server={server} schedule={data.schedule} onSaved={list.reload} />}

      <Dialog
        open={restoreTarget !== null}
        title="Backup wiederherstellen?"
        onClose={() => setRestoreTarget(null)}
        footer={
          <>
            <Button onClick={() => setRestoreTarget(null)}>Abbrechen</Button>
            <Button variant="danger-solid" icon={RotateCcw} loading={restoring} disabled={running} onClick={() => void restore()}>
              Wiederherstellen
            </Button>
          </>
        }
      >
        <Notice tone="warn" title="Die aktuelle Welt wird ersetzt">
          Der Stand vom {restoreTarget === null ? '' : formatDateTime(restoreTarget.createdAt)} ersetzt die jetzige Welt{restoreTarget?.includesConfig === true ? ' und die gesicherten Konfigurationsdateien' : ''}. Vorher wird automatisch ein Sicherheits-Backup des aktuellen Stands angelegt; schlägt etwas fehl, bleibt die alte Welt erhalten.
        </Notice>
        {running ? <Notice tone="error">Der Server läuft. Zum Wiederherstellen muss er zuerst gestoppt werden.</Notice> : null}
        {restoreError === null ? null : <ErrorNotice error={restoreError} />}
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        title="Backup löschen?"
        onClose={() => setDeleteTarget(null)}
        footer={
          <>
            <Button onClick={() => setDeleteTarget(null)}>Abbrechen</Button>
            <Button variant="danger-solid" icon={Trash2} loading={deleting} onClick={() => void remove()}>
              Löschen
            </Button>
          </>
        }
      >
        <p>
          Das Backup vom {deleteTarget === null ? '' : formatDateTime(deleteTarget.createdAt)} ({deleteTarget === null ? '' : KIND_LABEL[deleteTarget.kind].text}) wird unwiderruflich gelöscht.
        </p>
        {deleteError === null ? null : <ErrorNotice error={deleteError} />}
      </Dialog>
    </div>
  );
}
