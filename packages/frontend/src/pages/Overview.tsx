import { Cpu, Globe, HardDrive, Plus, Server, Users } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { ActionBar, ActionFeedback, useServerActions } from '../components/ServerActions';
import { LOADER_LABEL, Meter, StatusChip } from '../components/status';
import { Button, EmptyState, ErrorNotice, LoadingBlock, Notice } from '../components/ui';
import { useLive } from '../live/LiveProvider';
import type { CrashInfo, InstallProgress } from '../live/reducer';
import { systemApi } from '../lib/endpoints';
import { formatBytes, formatDuration, formatMb, formatPercent, plural } from '../lib/format';
import { Link, serverPath, useRouter } from '../lib/router';
import type { HealthInfo, RuntimeStatus, ServerView, SystemInfo } from '../lib/types';
import { useQuery, type QueryState } from '../lib/useQuery';

function lanHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function HostPanel({ health, system }: { health: QueryState<HealthInfo | null>; system: QueryState<SystemInfo> }): ReactNode {
  const urls = health.data?.lanUrls ?? [];
  const info = system.data;

  return (
    <section aria-label="Host" className="panel grid gap-x-8 gap-y-3 p-4 sm:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr]">
      <div className="min-w-0 space-y-1">
        <h2 className="flex items-center gap-2 text-sm text-dim">
          <Globe aria-hidden className="size-4" />
          Adressen im Netzwerk
        </h2>
        {urls.length === 0 ? (
          <p className="hint">{health.loading ? 'Wird ermittelt …' : 'Keine LAN-Adresse gefunden.'}</p>
        ) : (
          <ul className="space-y-0.5">
            {urls.map((url) => (
              <li key={url} className="num select-all font-mono text-sm">
                {url}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="min-w-0 space-y-1">
        <h2 className="flex items-center gap-2 text-sm text-dim">
          <HardDrive aria-hidden className="size-4" />
          Arbeitsspeicher
        </h2>
        {info === undefined ? (
          <p className="hint">{system.loading ? 'Wird ermittelt …' : 'Nicht verfügbar'}</p>
        ) : (
          <p className="num">
            <span className="text-lg font-semibold">{formatMb(info.totalMemoryMb)}</span> <span className="text-dim">gesamt, {formatMb(info.freeMemoryMb)} frei</span>
          </p>
        )}
      </div>
      <div className="min-w-0 space-y-1 sm:col-span-2 xl:col-span-1">
        <h2 className="flex items-center gap-2 text-sm text-dim">
          <Cpu aria-hidden className="size-4" />
          Prozessor und Java
        </h2>
        {info === undefined ? (
          <p className="hint">{system.loading ? 'Wird ermittelt …' : 'Nicht verfügbar'}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="num">{plural(info.cpuCount, 'Kern', 'Kerne')}</span>
            {info.javaRuntimes.length === 0 ? (
              <span className="chip chip-warn">Kein Java gefunden</span>
            ) : (
              info.javaRuntimes.map((runtime) => (
                <span key={runtime.path} className="chip" title={runtime.path}>
                  Java {runtime.major}
                </span>
              ))
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Summary({ servers, statuses }: { servers: ServerView[]; statuses: RuntimeStatus[] }): ReactNode {
  const online = statuses.filter((status) => status.state === 'online').length;
  const players = statuses.reduce((sum, status) => sum + status.players.length, 0);
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-dim">
      <span className="num">
        <strong className="text-ink">{online}</strong> von {servers.length} online
      </span>
      <span className="num inline-flex items-center gap-1.5">
        <Users aria-hidden className="size-4" />
        <strong className="text-ink">{players}</strong> {players === 1 ? 'Spieler' : 'Spieler'}
      </span>
    </p>
  );
}

interface RowProps {
  server: ServerView;
  status: RuntimeStatus;
  install: InstallProgress | undefined;
  crash: CrashInfo | undefined;
  host: string | null;
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).find((line) => line.trim() !== '') ?? text;
}

function ServerRow({ server, status, install, crash, host }: RowProps): ReactNode {
  const actions = useServerActions(server.id);
  const running = status.state !== 'offline' && status.state !== 'crashed';
  const ramRatio = status.rssBytes === null ? null : status.rssBytes / (server.maxRamMb * 1024 * 1024);
  const installed = server.installState === 'installed';
  const port = status.port ?? server.port;

  return (
    <li className="panel">
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_minmax(0,1.2fr)_auto] lg:items-center">
        <div className="min-w-0 space-y-1">
          <h3 className="text-base">
            <Link to={serverPath(server.id)} className="text-ink hover:text-accent">
              {server.name}
            </Link>
          </h3>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-dim">
            <span className="chip">{LOADER_LABEL[server.loader]}</span>
            <span className="num">Minecraft {server.mcVersion}</span>
            <span className="num text-faint" title={host === null ? undefined : `Verbinden mit ${host}:${port}`}>
              Port {port}
            </span>
          </p>
        </div>

        <div className="min-w-0 space-y-1">
          <StatusChip server={server} status={status} />
          {!installed ? (
            <p className="text-sm text-dim">
              {server.installState === 'failed' ? (
                <>
                  <span className="line-clamp-2">{server.installError === null ? 'Unbekannter Fehler.' : firstLine(server.installError)}</span>
                  <Link to={serverPath(server.id)}>Details und erneut versuchen</Link>
                </>
              ) : install === undefined ? (
                'Wartet …'
              ) : (
                <span className="num">
                  {install.message}
                  {install.percent === null ? '' : ` (${Math.round(install.percent)} %)`}
                </span>
              )}
            </p>
          ) : status.state === 'crashed' ? (
            <p className="text-sm text-bad">
              {status.exitCode === null ? 'Unerwartet beendet.' : `Exit-Code ${status.exitCode}.`}{' '}
              <Link to={serverPath(server.id)}>Details{crash === undefined ? '' : ' mit letzten Zeilen'}</Link>
            </p>
          ) : running && status.startedAt !== null ? (
            <p className="num text-sm text-dim">seit {formatDuration(Date.now() - status.startedAt)}</p>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0 space-y-1">
            <p className="num flex justify-between text-xs text-dim">
              <span>CPU</span>
              <span>{formatPercent(status.cpuPercent)}</span>
            </p>
            <Meter label={`CPU von ${server.name}`} value={status.cpuPercent === null ? null : status.cpuPercent / 100} valueText={formatPercent(status.cpuPercent)} />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="num flex justify-between gap-2 text-xs text-dim">
              <span>RAM</span>
              <span className="truncate">{status.rssBytes === null ? '–' : `${formatBytes(status.rssBytes)} / ${formatMb(server.maxRamMb)}`}</span>
            </p>
            <Meter label={`Arbeitsspeicher von ${server.name}`} value={ramRatio} valueText={status.rssBytes === null ? 'nicht gemessen' : formatBytes(status.rssBytes)} />
          </div>
        </div>

        <div className="min-w-0">
          <p className="num flex items-center gap-1.5 text-sm">
            <Users aria-hidden className="size-4 shrink-0 text-dim" />
            <span>{plural(status.players.length, 'Spieler', 'Spieler')}</span>
          </p>
          {status.players.length > 0 ? (
            <p className="truncate text-sm text-dim" title={status.players.join(', ')}>
              {status.players.join(', ')}
            </p>
          ) : null}
        </div>

        <div>
          <ActionBar server={server} status={status} actions={actions} compact />
        </div>
      </div>
      {actions.error !== null || actions.warnings.length > 0 ? (
        <div className="border-t border-line p-4">
          <ActionFeedback serverId={server.id} actions={actions} />
        </div>
      ) : null}
    </li>
  );
}

export function Overview(): ReactNode {
  const { state, statusFor, listError, refresh } = useLive();
  const { navigate } = useRouter();
  const servers = state.servers;

  useEffect(() => {
    document.title = 'Übersicht · CraftManager';
  }, []);

  const health = useQuery<HealthInfo | null>(() => systemApi.health().catch(() => null), []);
  const system = useQuery((signal) => systemApi.system(false, signal), []);
  const host = (health.data?.lanUrls ?? [])[0];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl">Übersicht</h1>
          {servers === null ? null : <Summary servers={servers} statuses={servers.map((server) => statusFor(server))} />}
        </div>
        <Button variant="primary" icon={Plus} onClick={() => navigate('/new')}>
          Neuer Server
        </Button>
      </div>

      <HostPanel health={health} system={system} />

      {listError !== null && servers === null ? (
        <ErrorNotice error={new Error(listError)} title="Die Serverliste konnte nicht geladen werden" action={<Button size="sm" onClick={() => void refresh()}>Erneut versuchen</Button>} />
      ) : servers === null ? (
        <LoadingBlock label="Server werden geladen …" />
      ) : servers.length === 0 ? (
        <EmptyState
          icon={Server}
          title="Noch kein Server angelegt"
          action={
            <Button variant="primary" icon={Plus} onClick={() => navigate('/new')}>
              Ersten Server anlegen
            </Button>
          }
        >
          <p>Der Assistent führt in wenigen Schritten durch Loader, Version, Port und Arbeitsspeicher. Die Installation läuft danach im Hintergrund.</p>
        </EmptyState>
      ) : (
        <>
          {listError === null ? null : <Notice tone="warn">Die Liste konnte zuletzt nicht aktualisiert werden: {listError}</Notice>}
          <ul className="space-y-3" aria-label="Server">
            {servers.map((server) => (
              <ServerRow
                key={server.id}
                server={server}
                status={statusFor(server)}
                install={state.installs[server.id]}
                crash={state.crashes[server.id]}
                host={host === undefined ? null : lanHost(host)}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
