import { createContext, useCallback, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';

export const SERVER_TABS = ['console', 'config', 'mods', 'store'] as const;
export type ServerTab = (typeof SERVER_TABS)[number];

export type Route =
  | { name: 'overview' }
  | { name: 'new' }
  | { name: 'server'; id: string; tab: ServerTab }
  | { name: 'not-found' };

const isTab = (value: string): value is ServerTab => (SERVER_TABS as readonly string[]).includes(value);

export function parseRoute(pathname: string): Route {
  const parts = pathname.split('/').filter((part) => part !== '');
  if (parts.length === 0) return { name: 'overview' };
  if (parts.length === 1 && parts[0] === 'new') return { name: 'new' };
  if (parts[0] === 'servers' && parts.length <= 3 && parts[1] !== undefined) {
    let id: string;
    try {
      id = decodeURIComponent(parts[1]);
    } catch {
      return { name: 'not-found' };
    }
    const tab = parts[2] ?? 'console';
    return isTab(tab) ? { name: 'server', id, tab } : { name: 'not-found' };
  }
  return { name: 'not-found' };
}

export const serverPath = (id: string, tab: ServerTab = 'console'): string => `/servers/${encodeURIComponent(id)}${tab === 'console' ? '' : `/${tab}`}`;

interface RouterValue {
  route: Route;
  navigate: (to: string, options?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

export function RouterProvider({ children }: { children: ReactNode }): ReactNode {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPop = (): void => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    if (options?.replace === true) window.history.replaceState(null, '', to);
    else window.history.pushState(null, '', to);
    setPathname(window.location.pathname);
    window.scrollTo(0, 0);
  }, []);

  const value = useMemo<RouterValue>(() => ({ route: parseRoute(pathname), navigate }), [pathname, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (value === null) throw new Error('useRouter muss innerhalb von RouterProvider verwendet werden.');
  return value;
}

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string;
}

export function Link({ to, onClick, children, ...rest }: LinkProps): ReactNode {
  const { navigate } = useRouter();
  const handleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}
