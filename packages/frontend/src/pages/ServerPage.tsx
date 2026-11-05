import { ArrowLeft, RotateCcw, ServerOff, Users } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { InstallPanel } from '../components/InstallPanel';
import { JavaProgress } from '../components/JavaProgress';
import { ActionBar, ActionFeedback, useServerActions } from '../components/ServerActions';
import { LOADER_LABEL, StatusChip } from '../components/status';
import { Button, EmptyState, ErrorNotice, LoadingBlock, Notice, cx } from '../components/ui';
import { formatDuration } from '../lib/format';
import { preparingMajor } from '../lib/java';
import { Link, serverPath, useRouter, type ServerTab } from '../lib/router';
import { useLive } from '../live/LiveProvider';
import { BackupsTab } from './server/BackupsTab';
import { ConfigTab } from './server/ConfigTab';
import { ConsoleTab } from './server/ConsoleTab';
import { contentNames, ModsTab } from './server/ModsTab';
import { StoreTab } from './server/StoreTab';

export function ServerPage({ id, tab }: { id: string; tab: ServerTab }): ReactNode {
  const { state, statusFor, listError, refresh } = useLive();
  const { navigate } = useRouter();
  const server = state.servers?.find((entry) => entry.id === id);
  const actions = useServerActions(id);

  useEffect(() => {
    document.title = `${server?.name ?? 'Server'} · CraftManager`;
  }, [server?.name]);

  // with five areas the tab row scrolls on a phone; the active one must not sit behind the edge
  useEffect(() => {
    document.querySelector('nav[aria-label="Bereiche des Servers"] [aria-current="page"]')?.scrollIntoView?.({ inline: 'center', block: 'nearest' });
  }, [tab, server?.id]);

  if (state.servers === null) {
    return listError === null ? (
      <LoadingBlock label="Server wird geladen …" />
    ) : (
      <ErrorNotice error={new Error(listError)} title="Der Server konnte nicht geladen werden" action={<Button size="sm" onClick={() => void refresh()}>Erneut versuchen</Button>} />
    );
  }
  if (server === undefined) {
    return (
      <EmptyState icon={ServerOff} title="Server nicht gefunden" action={<Button onClick={() => navigate('/')}>Zur Übersicht</Button>}>
        <p>Dieser Server existiert nicht (mehr). Möglicherweise wurde er gelöscht.</p>
      </EmptyState>
    );
  }

  const status = statusFor(server);
  const names = contentNames(server);
  const restartNeeded = state.restartNeeded[server.id] === true && (status.state === 'starting' || status.state === 'online');
  const installed = server.installState === 'installed';
  const tabs: Array<{ id: ServerTab; label: string }> = [
    { id: 'console', label: 'Konsole' },
    { id: 'config', label: 'Konfiguration' },
    { id: 'mods', label: names.plural },
    { id: 'store', label: names.store },
    { id: 'backups', label: 'Backups' },
  ];
  const waitingForJava = status.state === 'preparing' ? preparingMajor(status.message) : null;

  return (
    <div className="space-y-4">
      <Link to="/" className="link-btn gap-1.5 text-dim no-underline hover:text-ink">
        <ArrowLeft aria-hidden className="size-4" />
        Übersicht
      </Link>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-2xl">{server.name}</h1>
          <StatusChip server={server} status={status} />
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-dim">
          <span className="chip">{LOADER_LABEL[server.loader]}{server.loaderVersion === null ? '' : ` ${server.loaderVersion}`}</span>
          <span className="num">Minecraft {server.mcVersion}</span>
          <span className="num">Port {status.port ?? server.port}</span>
          {status.startedAt !== null && (status.state === 'online' || status.state === 'starting') ? <span className="num">läuft seit {formatDuration(Date.now() - status.startedAt)}</span> : null}
          <span className="num inline-flex items-center gap-1.5">
            <Users aria-hidden className="size-4" />
            {status.players.length === 0 ? 'Keine Spieler' : status.players.join(', ')}
          </span>
        </p>
        <ActionBar server={server} status={status} actions={actions} />
        <ActionFeedback serverId={server.id} actions={actions} />
        {status.state === 'preparing' ? (
          <Notice tone="info" title={status.message ?? 'Der Server wird vorbereitet ...'}>
            <p>Die passende Java-Version wird einmalig heruntergeladen und nur für CraftManager abgelegt. Danach startet der Server von selbst. „Abbrechen“ beendet den Vorgang.</p>
            {waitingForJava === null ? null : <JavaProgress major={waitingForJava} fallback={{ percent: null, message: null }} />}
          </Notice>
        ) : null}
        {restartNeeded ? (
          <Notice tone="warn" title="Neustart nötig">
            Geänderte Einstellungen gelten erst nach einem Neustart des Servers.
            <span className="mt-2 block">
              <Button size="sm" icon={RotateCcw} loading={actions.busy === 'restart'} disabled={actions.busy !== null || status.state !== 'online'} onClick={() => void actions.run('restart')}>
                Jetzt neu starten
              </Button>
            </span>
          </Notice>
        ) : null}
      </header>

      {installed ? null : (
        <section aria-label="Installation" className="panel space-y-3 p-4">
          <h2 className="text-base">Installation</h2>
          <InstallPanel server={server} />
        </section>
      )}

      <nav aria-label="Bereiche des Servers" className="-mx-4 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1">
          {tabs.map((entry) => {
            const active = entry.id === tab;
            return (
              <li key={entry.id}>
                <Link
                  to={serverPath(server.id, entry.id)}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'flex min-h-11 items-center border-b-2 px-2.5 text-sm font-medium no-underline sm:px-3.5 sm:text-base',
                    active ? 'border-accent text-ink' : 'border-transparent text-dim hover:text-ink',
                  )}
                >
                  {entry.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div role="region" aria-label={tabs.find((entry) => entry.id === tab)?.label}>
        {tab === 'console' ? <ConsoleTab key={server.id} server={server} status={status} /> : null}
        {tab === 'config' ? <ConfigTab key={server.id} server={server} status={status} /> : null}
        {tab === 'mods' ? <ModsTab key={server.id} server={server} status={status} /> : null}
        {tab === 'store' ? <StoreTab key={server.id} server={server} status={status} /> : null}
        {tab === 'backups' ? <BackupsTab key={server.id} server={server} status={status} /> : null}
      </div>
    </div>
  );
}
