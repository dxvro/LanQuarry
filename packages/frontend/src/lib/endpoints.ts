import { request } from './api';
import type {
  AuthStatus,
  Category,
  CreateServerInput,
  HealthInfo,
  InstallResultView,
  Loader,
  LoaderInfo,
  LoaderVersion,
  McVersion,
  ModLogEntry,
  ModView,
  PropertiesPatch,
  PropertiesView,
  RemoveResultView,
  RuntimeStatus,
  ScanAndUpdates,
  ScanReport,
  SearchIndex,
  SearchResponse,
  ServerView,
  SystemInfo,
  UpdateResult,
  UpdateServerInput,
} from './types';

const enc = encodeURIComponent;
const server = (id: string): string => `/api/servers/${enc(id)}`;

export const authApi = {
  status: (): Promise<AuthStatus> => request('/api/auth/status'),
  login: (token: string): Promise<AuthStatus> => request('/api/auth/login', { method: 'POST', body: { token }, ignoreUnauthorized: true }),
  logout: (): Promise<{ authenticated: false }> => request('/api/auth/logout', { method: 'POST', ignoreUnauthorized: true }),
};

export const systemApi = {
  health: (): Promise<HealthInfo> => request('/api/health'),
  system: (rescan = false, signal?: AbortSignal): Promise<SystemInfo> =>
    request('/api/system', { query: rescan ? { rescan: true } : {}, ...(signal === undefined ? {} : { signal }) }),
  loaders: async (): Promise<LoaderInfo[]> => (await request<{ loaders: LoaderInfo[] }>('/api/loaders')).loaders,
  mcVersions: async (loader: Loader, snapshots: boolean, signal?: AbortSignal): Promise<McVersion[]> =>
    (await request<{ mcVersions: McVersion[] }>(`/api/loaders/${enc(loader)}/mc-versions`, { query: { snapshots }, ...(signal === undefined ? {} : { signal }) }))
      .mcVersions,
  loaderVersions: async (loader: Loader, mcVersion: string, signal?: AbortSignal): Promise<LoaderVersion[]> =>
    (await request<{ versions: LoaderVersion[] }>(`/api/loaders/${enc(loader)}/versions`, { query: { mcVersion }, ...(signal === undefined ? {} : { signal }) }))
      .versions,
};

export const serversApi = {
  list: async (signal?: AbortSignal): Promise<ServerView[]> =>
    (await request<{ servers: ServerView[] }>('/api/servers', signal === undefined ? {} : { signal })).servers,
  get: async (id: string, signal?: AbortSignal): Promise<ServerView> =>
    (await request<{ server: ServerView }>(server(id), signal === undefined ? {} : { signal })).server,
  create: async (input: CreateServerInput): Promise<ServerView> =>
    (await request<{ server: ServerView }>('/api/servers', { method: 'POST', body: input })).server,
  update: (id: string, input: UpdateServerInput): Promise<{ server: ServerView; restartRequired: boolean }> =>
    request(server(id), { method: 'PATCH', body: input }),
  remove: (id: string): Promise<{ deleted: true }> => request(server(id), { method: 'DELETE', query: { confirm: true } }),
  install: async (id: string): Promise<ServerView> => (await request<{ server: ServerView }>(`${server(id)}/install`, { method: 'POST' })).server,
  start: (id: string): Promise<{ status: RuntimeStatus; warnings: string[] }> => request(`${server(id)}/start`, { method: 'POST' }),
  stop: (id: string): Promise<{ status: RuntimeStatus }> => request(`${server(id)}/stop`, { method: 'POST' }),
  restart: (id: string): Promise<{ status: RuntimeStatus; warnings: string[] }> => request(`${server(id)}/restart`, { method: 'POST' }),
  kill: (id: string): Promise<{ status: RuntimeStatus }> => request(`${server(id)}/kill`, { method: 'POST' }),
  properties: (id: string, signal?: AbortSignal): Promise<PropertiesView> =>
    request(`${server(id)}/properties`, signal === undefined ? {} : { signal }),
  patchProperties: (id: string, patch: PropertiesPatch): Promise<PropertiesView & { restartRequired: boolean }> =>
    request(`${server(id)}/properties`, { method: 'PATCH', body: patch }),
};

export interface SearchParams {
  query: string;
  categories: string[];
  index: SearchIndex;
  limit: number;
  offset: number;
}

export const modsApi = {
  list: async (id: string, signal?: AbortSignal): Promise<ModView[]> =>
    (await request<{ mods: ModView[] }>(`${server(id)}/mods`, signal === undefined ? {} : { signal })).mods,
  search: (id: string, params: SearchParams, signal?: AbortSignal): Promise<SearchResponse> =>
    request(`${server(id)}/mods/search`, {
      query: { query: params.query, categories: params.categories, index: params.index, limit: params.limit, offset: params.offset },
      ...(signal === undefined ? {} : { signal }),
    }),
  install: (id: string, projectId: string): Promise<InstallResultView> => request(`${server(id)}/mods`, { method: 'POST', body: { projectId } }),
  remove: (id: string, modId: string, force: boolean): Promise<RemoveResultView> =>
    request(`${server(id)}/mods/${enc(modId)}`, { method: 'DELETE', query: force ? { force: true } : {} }),
  scan: (id: string): Promise<ScanReport> => request(`${server(id)}/mods/scan`, { method: 'POST' }),
  checkUpdates: (id: string): Promise<ScanAndUpdates> => request(`${server(id)}/mods/updates/check`, { method: 'POST' }),
  applyUpdates: (id: string, projectIds?: string[]): Promise<{ results: UpdateResult[] }> =>
    request(`${server(id)}/mods/updates/apply`, { method: 'POST', body: projectIds === undefined ? {} : { projectIds } }),
  updateLog: async (id: string, limit = 50, signal?: AbortSignal): Promise<ModLogEntry[]> =>
    (await request<{ entries: ModLogEntry[] }>(`${server(id)}/mods/update-log`, { query: { limit }, ...(signal === undefined ? {} : { signal }) }))
      .entries,
  categories: async (signal?: AbortSignal): Promise<Category[]> =>
    (await request<{ categories: Category[] }>('/api/modrinth/categories', signal === undefined ? {} : { signal })).categories,
};
