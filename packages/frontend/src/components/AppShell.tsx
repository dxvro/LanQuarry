import { LayoutGrid, LogOut, Plus, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useLive } from '../live/LiveProvider';
import { Link, serverPath, useRouter } from '../lib/router';
import { StatusLed } from './status';
import { Button, cx } from './ui';

function Brand(): ReactNode {
  return (
    <Link to="/" className="flex items-center gap-2.5 rounded-md text-ink no-underline">
      <svg aria-hidden viewBox="0 0 32 32" className="size-7 shrink-0">
        <rect width="32" height="32" rx="7" fill="var(--color-raised)" />
        <rect x="6" y="7" width="20" height="5" rx="1.5" fill="var(--color-accent)" />
        <rect x="6" y="14" width="20" height="5" rx="1.5" fill="var(--color-ok)" />
        <rect x="6" y="21" width="12" height="5" rx="1.5" fill="var(--color-idle)" />
      </svg>
      <span className="text-base font-semibold tracking-tight">CraftManager</span>
    </Link>
  );
}

function navClass(active: boolean): string {
  return cx(
    'flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-dim no-underline hover:bg-raised hover:text-ink',
    active && 'bg-raised text-ink',
  );
}

function LogoutButton({ className }: { className?: string }): ReactNode {
  const { authRequired, logout } = useAuth();
  if (!authRequired) return null;
  return (
    <Button variant="ghost" size="sm" icon={LogOut} className={className} onClick={() => void logout()}>
      Abmelden
    </Button>
  );
}

function ConnectionBanner(): ReactNode {
  const { state } = useLive();
  if (state.connection === 'open') return null;
  return (
    <div role="alert" className="flex items-center gap-2 border-b border-warn/40 bg-warn/10 px-4 py-2 text-warn">
      <WifiOff aria-hidden className="size-4 shrink-0" />
      <p className="text-sm">
        {state.connection === 'connecting' ? 'Verbindung zum Server wird aufgebaut …' : 'Verbindung zum Server unterbrochen. Die angezeigten Daten sind möglicherweise veraltet, es wird automatisch neu verbunden.'}
      </p>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }): ReactNode {
  const { route } = useRouter();
  const { state, statusFor } = useLive();
  const servers = state.servers ?? [];

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_1fr]">
      <aside className="hidden border-r border-line bg-panel lg:flex lg:h-dvh lg:flex-col lg:sticky lg:top-0">
        <div className="p-4">
          <Brand />
        </div>
        <nav aria-label="Hauptnavigation" className="flex flex-col gap-1 px-3">
          <Link to="/" className={navClass(route.name === 'overview')} aria-current={route.name === 'overview' ? 'page' : undefined}>
            <LayoutGrid aria-hidden className="size-4" />
            Übersicht
          </Link>
          <Link to="/new" className={navClass(route.name === 'new')} aria-current={route.name === 'new' ? 'page' : undefined}>
            <Plus aria-hidden className="size-4" />
            Neuer Server
          </Link>
        </nav>
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          <h2 className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-faint">Server</h2>
          {servers.length === 0 ? (
            <p className="px-3 py-1 hint">{state.servers === null ? 'Wird geladen …' : 'Noch keine Server'}</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {servers.map((server) => {
                const active = route.name === 'server' && route.id === server.id;
                return (
                  <li key={server.id}>
                    <Link to={serverPath(server.id)} className={navClass(active)} aria-current={active ? 'page' : undefined}>
                      <StatusLed server={server} status={statusFor(server)} />
                      <span className="truncate">{server.name}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="border-t border-line p-3">
          <LogoutButton className="w-full justify-start" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line bg-panel/95 px-4 py-2.5 backdrop-blur-sm lg:hidden">
          <Brand />
          <LogoutButton />
        </header>
        <ConnectionBanner />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 pb-24 sm:px-6 lg:pb-8">{children}</main>
        <nav aria-label="Hauptnavigation" className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-2 border-t border-line bg-panel lg:hidden">
          <Link to="/" className={cx(navClass(route.name === 'overview' || route.name === 'server'), 'min-h-14 justify-center rounded-none')} aria-current={route.name === 'overview' ? 'page' : undefined}>
            <LayoutGrid aria-hidden className="size-5" />
            Übersicht
          </Link>
          <Link to="/new" className={cx(navClass(route.name === 'new'), 'min-h-14 justify-center rounded-none')} aria-current={route.name === 'new' ? 'page' : undefined}>
            <Plus aria-hidden className="size-5" />
            Neuer Server
          </Link>
        </nav>
      </div>
    </div>
  );
}
