import type {
  ExportJobDto,
  ExportOptionsDto,
  ImportJobDto,
  ImportLimitsDto,
  ImportNotice,
  ImportReviewDto,
  Loader,
  ModMatchDto,
  ServerDto,
} from '@craftmanager/backend/contract';
import { ApiError, NETWORK_ERROR, errorFromResponse, request } from './api';
import type { Wire } from './types';

export type ExportJobView = ExportJobDto;
export type ExportOptions = ExportOptionsDto;
export type ImportJobView = ImportJobDto;
export type ImportReview = ImportReviewDto;
export type ImportNoticeView = ImportNotice;
export type ModMatchView = ModMatchDto;

const enc = encodeURIComponent;

export interface SelectionInput {
  jars: string[];
  install: Array<{ key: string; projectId: string; versionId?: string }>;
}

export interface CreateFromImportBody {
  server: { name: string; loader: Loader; mcVersion: string; loaderVersion?: string; port?: number; minRamMb?: number; maxRamMb?: number; eulaAccepted?: boolean };
  importConfig: boolean;
  selection: SelectionInput;
  acknowledged: string[];
}

export const worldApi = {
  startExport: async (serverId: string, options: ExportOptions): Promise<ExportJobView> =>
    (await request<{ export: ExportJobView }>(`/api/servers/${enc(serverId)}/exports`, { method: 'POST', body: options })).export,
  startBackupExport: async (serverId: string, backupId: string, format: ExportOptions['format']): Promise<ExportJobView> =>
    (await request<{ export: ExportJobView }>(`/api/servers/${enc(serverId)}/backups/${enc(backupId)}/export`, { method: 'POST', body: { format } })).export,
  getExport: async (id: string, signal?: AbortSignal): Promise<ExportJobView> =>
    (await request<{ export: ExportJobView }>(`/api/exports/${enc(id)}`, signal === undefined ? {} : { signal })).export,
  removeExport: (id: string): Promise<{ deleted: true }> => request(`/api/exports/${enc(id)}`, { method: 'DELETE' }),
  // a plain link: the browser sends the session cookie
  exportDownloadUrl: (id: string): string => `/api/exports/${enc(id)}/download`,

  limits: (signal?: AbortSignal): Promise<Wire<ImportLimitsDto>> => request('/api/imports/limits', signal === undefined ? {} : { signal }),
  getImport: async (id: string, signal?: AbortSignal): Promise<ImportJobView> =>
    (await request<{ import: ImportJobView }>(`/api/imports/${enc(id)}`, signal === undefined ? {} : { signal })).import,
  cancelImport: (id: string): Promise<{ deleted: true }> => request(`/api/imports/${enc(id)}`, { method: 'DELETE' }),
  review: (id: string, target: { loader: Loader; mcVersion: string } | null, signal?: AbortSignal): Promise<ImportReview> =>
    request(`/api/imports/${enc(id)}/review`, { method: 'POST', body: target ?? {}, ...(signal === undefined ? {} : { signal }) }),
  createServer: (id: string, body: CreateFromImportBody): Promise<{ server: ServerDto; import: ImportJobView }> =>
    request(`/api/imports/${enc(id)}/create-server`, { method: 'POST', body }),
  replaceWorld: async (serverId: string, importId: string, acknowledged: string[]): Promise<ImportJobView> =>
    (await request<{ import: ImportJobView }>(`/api/servers/${enc(serverId)}/world/replace`, { method: 'POST', body: { importId, acknowledged } })).import,
};

// Streams the file as the raw request body (no multipart, nothing is read into memory) and reports progress.
export function uploadArchive(file: File, serverId: string | null, onProgress: (loaded: number, total: number) => void, signal?: AbortSignal): Promise<ImportJobView> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/imports${serverId === null ? '' : `?serverId=${enc(serverId)}`}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    };
    xhr.onerror = () => reject(new ApiError(0, NETWORK_ERROR, 'Der Upload ist fehlgeschlagen. Bitte die Netzwerkverbindung prüfen.'));
    xhr.onabort = () => reject(new DOMException('Abgebrochen', 'AbortError'));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve((JSON.parse(xhr.responseText) as { import: ImportJobView }).import);
        } catch {
          reject(new ApiError(xhr.status, 'INVALID_RESPONSE', 'Die Antwort des Servers ist unlesbar.'));
        }
      } else reject(errorFromResponse(xhr.status, xhr.responseText));
    };
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Abgebrochen', 'AbortError'));
    });
  });

// Polls an import until it is no longer being worked on (staged, done or failed)
export async function waitForImport(id: string, onUpdate: (job: ImportJobView) => void, signal?: AbortSignal, intervalMs = 800): Promise<ImportJobView> {
  for (;;) {
    const job = await worldApi.getImport(id, signal);
    onUpdate(job);
    if (job.status === 'staged' || job.status === 'done' || job.status === 'failed') return job;
    await sleep(intervalMs, signal);
  }
}

export async function waitForExport(id: string, onUpdate: (job: ExportJobView) => void, signal?: AbortSignal, intervalMs = 800): Promise<ExportJobView> {
  for (;;) {
    const job = await worldApi.getExport(id, signal);
    onUpdate(job);
    if (job.status !== 'running') return job;
    await sleep(intervalMs, signal);
  }
}

// ---- pure helpers ---------------------------------------------------------------------------

export interface MatchChoice {
  selected: boolean;
  // for several hits on Modrinth: the project the user picked
  candidate: string | null;
}

export type Choices = Record<string, MatchChoice>;

export function initialChoices(matches: readonly ModMatchView[]): Choices {
  return Object.fromEntries(matches.map((match) => [match.key, { selected: match.selected, candidate: null }]));
}

// What goes to the backend: jars to place, projects to install
export function buildSelection(matches: readonly ModMatchView[], choices: Choices): SelectionInput {
  const jars: string[] = [];
  const install: SelectionInput['install'] = [];
  for (const match of matches) {
    const choice = choices[match.key];
    if (choice === undefined) continue;
    if ((match.state === 'jar' || match.state === 'jar-known') && choice.selected) jars.push(match.key);
    else if (match.state === 'found' && choice.selected && match.projectId !== null) {
      install.push({ key: match.key, projectId: match.projectId, ...(match.versionId === null ? {} : { versionId: match.versionId }) });
    } else if (match.state === 'ambiguous' && choice.candidate !== null) {
      install.push({ key: match.key, projectId: choice.candidate });
    }
  }
  return { jars, install };
}

export const needsAck = (notices: readonly ImportNoticeView[]): ImportNoticeView[] => notices.filter((notice) => notice.needsConfirm);
export const hasBlocker = (notices: readonly ImportNoticeView[]): boolean => notices.some((notice) => notice.level === 'error');
export const allAcknowledged = (notices: readonly ImportNoticeView[], acknowledged: readonly string[]): boolean =>
  needsAck(notices).every((notice) => acknowledged.includes(notice.code));

export const GAME_TYPE: Record<number, string> = { 0: 'Überleben', 1: 'Kreativ', 2: 'Abenteuer', 3: 'Zuschauer' };

export const SOURCE_LABEL = {
  'cm-export': 'CraftManager-Export',
  server: 'Server-Ordner',
  world: 'Einzelspieler-Welt',
} as const;

export const MATCH_LABEL: Record<ModMatchView['state'], { text: string; chip: string }> = {
  'jar-known': { text: 'Datei aus dem Archiv, auf Modrinth erkannt', chip: 'chip-ok' },
  jar: { text: 'Datei aus dem Archiv', chip: '' },
  'wrong-loader': { text: 'Gehört zu einem anderen Loader', chip: 'chip-warn' },
  found: { text: 'Auf Modrinth gefunden', chip: 'chip-ok' },
  ambiguous: { text: 'Mehrere Treffer, bitte wählen', chip: 'chip-warn' },
  incompatible: { text: 'Keine passende Version', chip: 'chip-bad' },
  'not-found': { text: 'Nicht gefunden', chip: 'chip-bad' },
  'client-only': { text: 'Nur für den Client', chip: '' },
};

export const isBusyJob = (job: ImportJobView | null): boolean => job !== null && (job.status === 'uploading' || job.status === 'analyzing' || job.status === 'applying');
