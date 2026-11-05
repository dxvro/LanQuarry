import { ArrowUpCircle, History, PackageX, ScanSearch, Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Dialog } from '../../components/Dialog';
import { Button, EmptyState, ErrorNotice, LoadingBlock, Notice, Section, Switch, cx } from '../../components/ui';
import { modsApi } from '../../lib/endpoints';
import { formatBytes, formatDateTime, plural } from '../../lib/format';
import { Link, serverPath } from '../../lib/router';
import type { ModLogEntry, ModView, RuntimeStatus, ScanAndUpdates, ServerView, UpdateResult } from '../../lib/types';
import { useQuery } from '../../lib/useQuery';
import { useLive } from '../../live/LiveProvider';
import { ModBackups } from './ModBackups';
import { useModRemoval } from './useModRemoval';
import { useModToggle } from './useModToggle';

export const contentNames = (server: Pick<ServerView, 'loader'>): { singular: string; plural: string; store: string } =>
  server.loader === 'paper' ? { singular: 'Plugin', plural: 'Plugins', store: 'Plugin-Store' } : { singular: 'Mod', plural: 'Mods', store: 'Mod-Store' };

export function isLocked(status: Pick<RuntimeStatus, 'state'>): boolean {
  return status.state === 'preparing' || status.state === 'starting' || status.state === 'online' || status.state === 'stopping';
}

export type ModFilter = 'all' | 'enabled' | 'disabled';

export const FILTER_LABEL: Record<ModFilter, string> = { all: 'Alle', enabled: 'Aktiv', disabled: 'Deaktiviert' };

export const matchesFilter = (mod: Pick<ModView, 'enabled'>, filter: ModFilter): boolean => filter === 'all' || (filter === 'enabled') === mod.enabled;

export function NoModsSupport({ server }: { server: ServerView }): ReactNode {
  return (
    <EmptyState icon={PackageX} title="Vanilla-Server haben keine Mods oder Plugins">
      <p>
        „{server.name}“ läuft mit dem unveränderten Minecraft-Server von Mojang. Mods gibt es nur für Fabric, Forge und NeoForge, Plugins nur für Paper. Um sie zu nutzen, muss ein neuer Server mit einem passenden Loader angelegt werden.
      </p>
    </EmptyState>
  );
}

export function RunningLock({ server, what }: { server: ServerView; what: string }): ReactNode {
  return (
    <Notice tone="warn" title={`${what} sind gesperrt, solange der Server läuft`}>
      Das Ändern von Dateien bei laufendem Server könnte ihn beschädigen (Fehlercode SERVER_RUNNING). Bitte „{server.name}“ zuerst{' '}
      <Link to={serverPath(server.id)}>in der Konsole stoppen</Link>.
    </Notice>
  );
}

const STATUS_LABEL: Record<UpdateResult['status'], { text: string; chip: string }> = {
  success: { text: 'Aktualisiert', chip: 'chip-ok' },
  failed: { text: 'Fehlgeschlagen', chip: 'chip-bad' },
  rolled_back: { text: 'Zurückgesetzt', chip: 'chip-warn' },
};

interface RowProps {
  mod: ModView;
  locked: boolean;
  update: boolean;
  busy: boolean;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
  names: ReturnType<typeof contentNames>;
}

function ModRow({ mod, locked, update, busy, onDelete, onToggle, names }: RowProps): ReactNode {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" data-enabled={mod.enabled}>
      <Switch
        checked={mod.enabled}
        onChange={onToggle}
        label={`${mod.name} ${mod.enabled ? 'deaktivieren' : 'aktivieren'}`}
        disabled={locked || busy}
        title={locked ? 'Nur bei gestopptem Server möglich' : mod.enabled ? `${names.singular} deaktivieren` : `${names.singular} aktivieren`}
      />
      <div className={cx('min-w-0 flex-1 basis-44', !mod.enabled && 'opacity-60')}>
        <p className="flex flex-wrap items-center gap-2 font-medium">
          <span className="min-w-0 break-words">{mod.name}</span>
          {mod.enabled ? null : <span className="chip chip-warn">Deaktiviert</span>}
          {update ? <span className="chip chip-accent">Update verfügbar</span> : null}
        </p>
        <p className="num text-sm text-dim">
          {mod.versionNumber === null ? 'Version unbekannt' : `Version ${mod.versionNumber}`} · <span className="font-mono text-xs">{mod.fileName}</span>
        </p>
      </div>
      <div className={cx('flex flex-wrap items-center gap-2', !mod.enabled && 'opacity-60')}>
        <span className={cx('chip', mod.source === 'modrinth' ? 'chip-accent' : '')}>{mod.source === 'modrinth' ? 'Modrinth' : 'Manuell'}</span>
        <span className="num hint">{formatBytes(mod.sizeBytes)}</span>
        <Button size="sm" variant="danger" icon={Trash2} disabled={locked} title={locked ? 'Gesperrt, solange der Server läuft' : `${names.singular} entfernen`} onClick={onDelete}>
          Entfernen
        </Button>
      </div>
    </li>
  );
}

function ModGroup({ title, description, mods, ...rest }: { title: string; description: string; mods: ModView[]; locked: boolean; updates: Set<string>; busyId: string | null; onDelete: (mod: ModView) => void; onToggle: (mod: ModView, enabled: boolean) => void; names: ReturnType<typeof contentNames> }): ReactNode {
  if (mods.length === 0) return null;
  return (
    <section aria-label={title} className="panel overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <h3 className="text-base">
          {title} <span className="num text-dim">({mods.length})</span>
        </h3>
        <p className="hint">{description}</p>
      </div>
      <ul className="divide-y divide-line">
        {mods.map((mod) => (
          <ModRow key={mod.id} mod={mod} locked={rest.locked} busy={rest.busyId === mod.id} update={mod.projectId !== null && rest.updates.has(mod.projectId)} names={rest.names} onDelete={() => rest.onDelete(mod)} onToggle={(enabled) => rest.onToggle(mod, enabled)} />
        ))}
      </ul>
    </section>
  );
}

function UpdateLog({ serverId }: { serverId: string }): ReactNode {
  const log = useQuery((signal) => modsApi.updateLog(serverId, 50, signal), [serverId]);
  if (log.loading) return <LoadingBlock label="Protokoll wird geladen …" />;
  if (log.error !== null) return <ErrorNotice error={log.error} action={<Button size="sm" onClick={log.reload}>Erneut versuchen</Button>} />;
  const entries: ModLogEntry[] = log.data ?? [];
  if (entries.length === 0) return <p className="hint">Es wurden noch keine Updates durchgeführt.</p>;
  return (
    <ul className="divide-y divide-line">
      {entries.map((entry) => (
        <li key={entry.id} className="space-y-0.5 py-2">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{entry.modName}</span>
            <span className={cx('chip', STATUS_LABEL[entry.status].chip)}>{STATUS_LABEL[entry.status].text}</span>
            <span className="num hint">{formatDateTime(entry.createdAt)}</span>
          </p>
          <p className="font-mono text-xs text-dim">
            {entry.fromFileName ?? '?'} → {entry.toFileName ?? '?'}
          </p>
          {entry.error === null ? null : <p className="text-sm text-bad">{entry.error}</p>}
        </li>
      ))}
    </ul>
  );
}

export function ModsTab({ server, status }: { server: ServerView; status: RuntimeStatus }): ReactNode {
  const names = contentNames(server);
  const locked = isLocked(status);
  const { state } = useLive();
  const supported = server.loader !== 'vanilla';
  const list = useQuery((signal) => modsApi.list(server.id, signal), [server.id], supported);
  const removal = useModRemoval(server.id, list.reload);
  const switcher = useModToggle(server.id, list.reload);
  const [filter, setFilter] = useState<ModFilter>('all');
  const [backupVersion, setBackupVersion] = useState(0);

  const [busy, setBusy] = useState<'scan' | 'check' | 'apply' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [scanInfo, setScanInfo] = useState<ScanAndUpdates | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<UpdateResult[] | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [checked, setChecked] = useState(false);

  const updates = scanInfo?.updates ?? [];
  const updateProjects = useMemo(() => new Set(updates.map((update) => update.projectId)), [updates]);
  const mods = list.data ?? [];
  const shown = mods.filter((mod) => matchesFilter(mod, filter));
  const disabledCount = mods.filter((mod) => !mod.enabled).length;
  const direct = shown.filter((mod) => mod.source === 'modrinth' && !mod.isDependency);
  const dependencies = shown.filter((mod) => mod.source === 'modrinth' && mod.isDependency);
  const manual = shown.filter((mod) => mod.source !== 'modrinth');
  const liveUpdates = state.modUpdates[server.id];

  if (!supported) return <NoModsSupport server={server} />;

  const run = async (kind: 'scan' | 'check' | 'apply', action: () => Promise<void>): Promise<void> => {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(null);
    }
  };

  const scan = (): Promise<void> =>
    run('scan', async () => {
      const report = await modsApi.scan(server.id);
      setScanInfo({ updates: scanInfo?.updates ?? [], scan: report });
      list.reload();
    });
  const check = (): Promise<void> =>
    run('check', async () => {
      const found = await modsApi.checkUpdates(server.id);
      setScanInfo(found);
      setChecked(true);
      setSelected(new Set(found.updates.map((update) => update.projectId)));
      setResults(null);
      list.reload();
    });
  const apply = (projectIds?: string[]): Promise<void> =>
    run('apply', async () => {
      const applied = await modsApi.applyUpdates(server.id, projectIds);
      setResults(applied.results);
      setScanInfo((current) => (current === null ? null : { ...current, updates: current.updates.filter((update) => !applied.results.some((result) => result.modId === update.modId && result.status === 'success')) }));
      setBackupVersion((value) => value + 1);
      list.reload();
    });

  const toggle = (projectId: string): void =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });

  return (
    <div className="space-y-4">
      {locked ? <RunningLock server={server} what={names.plural} /> : null}

      {liveUpdates === undefined || !liveUpdates.ok || liveUpdates.count === 0 ? null : (
        <Notice tone="info" title={`${plural(liveUpdates.count, 'Update', 'Updates')} verfügbar`} action={<Button size="sm" onClick={() => void check()} disabled={busy !== null}>Jetzt prüfen</Button>}>
          Die Prüfung nach dem Serverstart hat neuere Versionen gefunden: {liveUpdates.projects.join(', ')}.
        </Notice>
      )}
      {liveUpdates !== undefined && !liveUpdates.ok ? <Notice tone="warn">Die automatische Update-Prüfung ist fehlgeschlagen{liveUpdates.error === null ? '' : `: ${liveUpdates.error}`}.</Notice> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button icon={ScanSearch} loading={busy === 'scan'} disabled={busy !== null} onClick={() => void scan()}>
          Ordner scannen
        </Button>
        <Button icon={ArrowUpCircle} loading={busy === 'check'} disabled={busy !== null} onClick={() => void check()}>
          Auf Updates prüfen
        </Button>
        <Button variant="ghost" icon={History} aria-expanded={showLog} onClick={() => setShowLog((value) => !value)}>
          Update-Protokoll
        </Button>
        <Link to={serverPath(server.id, 'store')} className="link-btn ml-auto">
          Zum {names.store}
        </Link>
      </div>

      {error === null ? null : <ErrorNotice error={error} />}
      {switcher.error === null ? null : <ErrorNotice error={switcher.error} title={`Der Zustand des ${names.singular}s wurde nicht geändert`} />}

      {scanInfo === null ? null : (
        <Notice tone={scanInfo.scan.modrinthAvailable ? 'success' : 'warn'} title="Ergebnis des Scans">
          <p className="num">
            {plural(scanInfo.scan.scanned, 'Datei', 'Dateien')} gefunden: {scanInfo.scan.added} neu, {scanInfo.scan.removed} entfernt, {scanInfo.scan.renamed} umbenannt, {scanInfo.scan.replaced} geändert, {scanInfo.scan.toggled} (de)aktiviert, {scanInfo.scan.identified} bei Modrinth erkannt.
          </p>
          {scanInfo.scan.warnings.length === 0 ? null : (
            <ul className="mt-1 list-disc pl-5">
              {scanInfo.scan.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}

      {checked && updates.length === 0 && results === null && busy === null ? <Notice tone="success">Alle {names.plural} mit Modrinth-Quelle sind aktuell.</Notice> : null}

      {updates.length === 0 ? null : (
        <Section
          title={`${plural(updates.length, 'Update', 'Updates')} verfügbar`}
          description="Vor jedem Update wird die alte Datei gesichert. Schlägt es fehl, wird sie wiederhergestellt."
          action={
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon={ArrowUpCircle} disabled={busy !== null || locked || selected.size === 0} loading={busy === 'apply'} onClick={() => void apply([...selected])}>
                Ausgewählte aktualisieren ({selected.size})
              </Button>
              <Button disabled={busy !== null || locked} onClick={() => void apply()}>
                Alle aktualisieren
              </Button>
            </div>
          }
        >
          <ul className="divide-y divide-line">
            {updates.map((update) => (
              <li key={update.modId} className="py-2">
                <label className="flex cursor-pointer items-start gap-3">
                  <input type="checkbox" checked={selected.has(update.projectId)} onChange={() => toggle(update.projectId)} className="mt-1 size-5 shrink-0 accent-[var(--color-accent)]" />
                  <span className="min-w-0">
                    <span className="block font-medium">{update.name}</span>
                    <span className="num block text-sm text-dim">
                      {update.currentVersionNumber} → {update.newVersionNumber} {update.versionType === 'release' ? '' : `(${update.versionType})`}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {results === null ? null : (
        <Section title="Ergebnis der Updates">
          <ul className="divide-y divide-line" aria-label="Update-Ergebnisse">
            {results.length === 0 ? <li className="py-2 text-dim">Es gab nichts zu aktualisieren.</li> : null}
            {results.map((result) => (
              <li key={result.modId} className="space-y-0.5 py-2">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{result.name}</span>
                  <span className={cx('chip', STATUS_LABEL[result.status].chip)}>{STATUS_LABEL[result.status].text}</span>
                </p>
                {result.error === undefined ? null : <p className="text-sm text-bad">{result.error}</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {showLog ? (
        <Section title="Update-Protokoll" description="Die letzten 50 Einträge, neueste zuerst.">
          <UpdateLog serverId={server.id} />
        </Section>
      ) : null}

      {switcher.result === null ? null : (
        <Notice
          tone={switcher.result.data.warnings.length > 0 || switcher.result.data.dependencies.length > 0 ? 'warn' : 'success'}
          title={
            switcher.result.data.changed.length === 0
              ? `„${switcher.result.data.mod.name}“ war bereits ${switcher.result.enabled ? 'aktiv' : 'deaktiviert'}`
              : `„${switcher.result.data.mod.name}“ ist jetzt ${switcher.result.enabled ? 'aktiv' : 'deaktiviert'}`
          }
          action={<Button size="sm" variant="ghost" onClick={switcher.dismissResult}>Ausblenden</Button>}
        >
          {switcher.result.data.dependencies.length === 0 ? null : (
            <>
              <p>Diese benötigten Abhängigkeiten waren deaktiviert und wurden ebenfalls aktiviert:</p>
              <ul className="mt-1 list-disc pl-5" aria-label="Zusätzlich aktivierte Abhängigkeiten">
                {switcher.result.data.dependencies.map((dependency) => (
                  <li key={dependency.id} className="font-medium text-ink">
                    {dependency.name}
                  </li>
                ))}
              </ul>
            </>
          )}
          {switcher.result.data.warnings.filter((warning) => !warning.includes('als benötigte Abhängigkeit')).map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </Notice>
      )}

      {removal.result === null ? null : (
        <Notice
          tone={removal.result.orphaned.length > 0 ? 'warn' : 'success'}
          title={`„${removal.result.removed.name}“ wurde entfernt`}
          action={<Button size="sm" variant="ghost" onClick={removal.dismissResult}>Ausblenden</Button>}
        >
          {removal.result.orphaned.length === 0 ? null : (
            <>
              <p>Diese Abhängigkeiten werden nun von keinem {names.singular} mehr gebraucht und können entfernt werden:</p>
              <ul className="mt-1 space-y-1">
                {removal.result.orphaned.map((orphan) => {
                  const current = mods.find((mod) => mod.id === orphan.id);
                  return (
                    <li key={orphan.id} className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{orphan.name}</span>
                      {current === undefined ? null : (
                        <Button size="sm" variant="danger" icon={Trash2} disabled={locked} onClick={() => removal.open(current)}>
                          Entfernen
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Notice>
      )}

      {list.loading && list.data === undefined ? (
        <LoadingBlock label={`${names.plural} werden geladen …`} />
      ) : list.error !== null && list.data === undefined ? (
        <ErrorNotice error={list.error} title={`${names.plural} konnten nicht geladen werden`} action={<Button size="sm" onClick={list.reload}>Erneut versuchen</Button>} />
      ) : mods.length === 0 ? (
        <EmptyState icon={PackageX} title={`Noch keine ${names.plural} installiert`} action={<Link to={serverPath(server.id, 'store')} className="link-btn">Im {names.store} suchen</Link>}>
          <p>Dateien, die du von Hand in den Ordner legst, erkennt der Scan und ordnet sie, wenn möglich, Modrinth zu.</p>
        </EmptyState>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label={`${names.plural} filtern`} className="flex flex-wrap gap-1.5">
              {(Object.keys(FILTER_LABEL) as ModFilter[]).map((key) => (
                <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} className="chip min-h-9 cursor-pointer px-3 aria-pressed:border-accent aria-pressed:text-ink">
                  {FILTER_LABEL[key]}
                  <span className="num text-dim">{key === 'all' ? mods.length : key === 'enabled' ? mods.length - disabledCount : disabledCount}</span>
                </button>
              ))}
            </div>
            <p className="hint min-w-0 flex-1 basis-64">
              Deaktivierte Dateien erhalten die Endung .jar.disabled und werden vom Server nicht geladen. Das Umschalten geht nur bei gestopptem Server.
            </p>
          </div>
          {shown.length === 0 ? <p className="hint">Keine Einträge für diesen Filter.</p> : null}
          <ModGroup title={`Direkt gewählte ${names.plural}`} description={`Diese ${names.plural} wurden bewusst installiert.`} mods={direct} locked={locked} updates={updateProjects} busyId={switcher.busyId} names={names} onDelete={removal.open} onToggle={(mod, enabled) => void switcher.toggle(mod, enabled)} />
          <ModGroup title="Abhängigkeiten" description={`Automatisch mitinstalliert, weil andere ${names.plural} sie brauchen.`} mods={dependencies} locked={locked} updates={updateProjects} busyId={switcher.busyId} names={names} onDelete={removal.open} onToggle={(mod, enabled) => void switcher.toggle(mod, enabled)} />
          <ModGroup title="Manuell hinzugefügt oder nicht erkannt" description="Dateien ohne Modrinth-Zuordnung. Sie lassen sich nicht automatisch aktualisieren." mods={manual} locked={locked} updates={updateProjects} busyId={switcher.busyId} names={names} onDelete={removal.open} onToggle={(mod, enabled) => void switcher.toggle(mod, enabled)} />
        </div>
      )}

      <ModBackups serverId={server.id} folder={server.loader === 'paper' ? 'plugins_backup' : 'mods_backup'} version={backupVersion} />

      <Dialog
        open={switcher.pending !== null}
        title={`„${switcher.pending?.name ?? ''}“ wird noch gebraucht`}
        onClose={switcher.cancel}
        footer={
          <>
            <Button onClick={switcher.cancel}>Abbrechen</Button>
            <Button variant="danger-solid" loading={switcher.busyId !== null} onClick={() => void switcher.confirmForce()}>
              Trotzdem deaktivieren
            </Button>
          </>
        }
      >
        <Notice tone="warn" title="Andere aktive Einträge benötigen dieses Element">
          Wird es deaktiviert, funktionieren diese möglicherweise nicht mehr oder der Server startet nicht:
        </Notice>
        <ul className="list-disc space-y-0.5 pl-5" aria-label="Betroffene Einträge">
          {switcher.dependents.map((dependent) => (
            <li key={dependent.id}>{dependent.name}</li>
          ))}
        </ul>
      </Dialog>

      <Dialog
        open={removal.target !== null}
        title={removal.phase === 'dependents' ? `„${removal.target?.name ?? ''}“ wird noch gebraucht` : `${names.singular} entfernen?`}
        onClose={removal.cancel}
        footer={
          <>
            <Button onClick={removal.cancel}>Abbrechen</Button>
            <Button variant="danger-solid" icon={Trash2} loading={removal.busy} onClick={() => void removal.confirm()}>
              {removal.phase === 'dependents' ? 'Trotzdem entfernen' : 'Entfernen'}
            </Button>
          </>
        }
      >
        {removal.phase === 'dependents' ? (
          <>
            <Notice tone="warn" title="Andere Einträge benötigen dieses Element">
              Wird es entfernt, funktionieren diese möglicherweise nicht mehr:
            </Notice>
            <ul className="list-disc space-y-0.5 pl-5" aria-label="Betroffene Einträge">
              {removal.dependents.map((dependent) => (
                <li key={dependent.id}>{dependent.name}</li>
              ))}
            </ul>
          </>
        ) : (
          <p>
            Die Datei <span className="font-mono text-sm">{removal.target?.fileName}</span> wird aus dem Ordner gelöscht.
          </p>
        )}
        {removal.error === null ? null : <ErrorNotice error={removal.error} />}
      </Dialog>
    </div>
  );
}
