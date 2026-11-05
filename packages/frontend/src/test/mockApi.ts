import { vi } from 'vitest';

export const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export interface Call {
  method: string;
  url: string;
  body: unknown;
}

export type Handler = (call: Call) => Response | { status?: number; body: unknown };

export interface MockApi {
  calls: Call[];
  set: (route: string, handler: Handler) => void;
  callsTo: (route: string) => Call[];
}

export const offline = { state: 'offline', pid: null, startedAt: null, exitCode: null, message: null, players: [], port: null, cpuPercent: null, rssBytes: null };

export const serverFixture = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'srv-1',
  name: 'Survival',
  loader: 'fabric',
  mcVersion: '1.21.1',
  loaderVersion: '0.16.0',
  installState: 'installed',
  installError: null,
  launchSpec: null,
  requiredJavaMajor: 21,
  port: 25565,
  javaPath: null,
  minRamMb: 1024,
  maxRamMb: 2048,
  useAikarFlags: false,
  extraJvmArgs: '',
  eulaAccepted: true,
  autoStart: false,
  backupIntervalHours: null,
  backupKeepLast: 7,
  backupIncludeConfig: false,
  backupScheduleSince: null,
  lastStartedAt: null,
  lastExitCode: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  status: offline,
  ...overrides,
});

export const systemFixture = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  totalMemoryMb: 16384,
  freeMemoryMb: 8000,
  cpuCount: 8,
  platform: 'win32',
  arch: 'x64',
  javaRuntimes: [],
  javaAutoInstall: true,
  managedJava: [],
  javaInstalls: [],
  ...overrides,
});

// Routes are "METHOD /path-prefix"; the longest matching prefix wins. Unknown requests answer 404.
export function mockApi(routes: Record<string, Handler>): MockApi {
  const table = new Map(Object.entries(routes));
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const method = init?.method ?? 'GET';
      const url = String(input);
      const path = url.split('?')[0] ?? url;
      const call: Call = { method, url, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) };
      calls.push(call);
      const key = [...table.keys()]
        .filter((candidate) => {
          const [m, prefix] = candidate.split(' ');
          return m === method && prefix !== undefined && path.startsWith(prefix);
        })
        .sort((a, b) => b.length - a.length)[0];
      if (key === undefined) return json(404, { error: { code: 'NOT_FOUND', message: `nicht gefunden: ${method} ${url}` } });
      const result = (table.get(key) as Handler)(call);
      return result instanceof Response ? result : json(result.status ?? 200, result.body);
    }),
  );
  return {
    calls,
    set: (route, handler) => void table.set(route, handler),
    callsTo: (route) => {
      const [m, prefix] = route.split(' ');
      return calls.filter((call) => call.method === m && (call.url.split('?')[0] ?? '').startsWith(prefix ?? ''));
    },
  };
}

export const baseRoutes = (server: Record<string, unknown>, system: Record<string, unknown> = systemFixture()): Record<string, Handler> => ({
  'GET /api/auth/status': () => ({ body: { authRequired: false, authenticated: true } }),
  'GET /api/health': () => ({ body: { status: 'ok', database: 'ok', lanUrls: [] } }),
  'GET /api/servers': () => ({ body: { servers: [server] } }),
  'GET /api/system': () => ({ body: system }),
});
