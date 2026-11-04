import { createHash, randomUUID, type Hash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError } from '../http/errors.js';
import { removeQuietly } from './files.js';

export const DEFAULT_ALLOWED_HOSTS: readonly string[] = ['cdn.modrinth.com'];
const MAX_REDIRECTS = 3;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export type HashAlgorithm = 'sha1' | 'sha256' | 'sha512';

export interface DownloaderOptions {
  fetch: typeof fetch;
  allowedHosts: readonly string[];
  timeoutMs: number;
  headers?: Readonly<Record<string, string>>;
}

export const defaultDownloaderOptions = (): DownloaderOptions => ({
  fetch,
  allowedHosts: DEFAULT_ALLOWED_HOSTS,
  timeoutMs: 5 * 60_000,
});

export interface DownloadSpec {
  url: string;
  fileName: string;
  hash?: { algorithm: HashAlgorithm; value: string };
  size?: number;
  allowedHosts?: readonly string[];
  requireZip?: boolean;
  onProgress?: (receivedBytes: number, totalBytes: number | null) => void;
}

const unsafeName = (): AppError =>
  new AppError(502, 'UNSAFE_FILENAME', 'Die Quelle hat einen unzulässigen Dateinamen geliefert. Der Download wurde abgebrochen.');

export function sanitizeJarName(name: string): string {
  const stem = name.replace(/\.jar$/i, '');
  const valid =
    name.length > 4 &&
    name.length <= 200 &&
    /\.jar$/i.test(name) &&
    !/[\\/:*?"<>|\u0000-\u001f]/.test(name) &&
    !name.includes('..') &&
    path.posix.basename(name) === name &&
    path.win32.basename(name) === name &&
    !path.isAbsolute(name) &&
    !WINDOWS_RESERVED.test(stem.split('.')[0] ?? '') &&
    !/[ .]$/.test(stem) &&
    !name.startsWith(' ');
  if (!valid) throw unsafeName();
  return name;
}

function assertAllowedUrl(raw: string, allowedHosts: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError(502, 'DOWNLOAD_URL_REJECTED', 'Die Download-Adresse ist ungültig.');
  }
  if (url.protocol !== 'https:' || !allowedHosts.includes(url.hostname)) {
    throw new AppError(502, 'DOWNLOAD_URL_REJECTED', `Downloads von „${url.hostname}“ sind nicht erlaubt.`);
  }
  return url;
}

export function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

// follows redirects by hand so that every hop is checked against the allowlist
export async function fetchAllowed(
  rawUrl: string,
  allowedHosts: readonly string[],
  options: Pick<DownloaderOptions, 'fetch' | 'timeoutMs' | 'headers'>,
  extraHeaders: Readonly<Record<string, string>> = {},
): Promise<Response> {
  let url = assertAllowedUrl(rawUrl, allowedHosts);
  const headers = { ...options.headers, ...extraHeaders };
  for (let hop = 0; ; hop++) {
    let response: Response;
    try {
      response = await options.fetch(url, { redirect: 'manual', headers, signal: AbortSignal.timeout(options.timeoutMs) });
    } catch (error) {
      if (isTimeoutError(error)) throw new AppError(504, 'DOWNLOAD_TIMEOUT', 'Der Download hat zu lange gedauert.');
      throw new AppError(502, 'DOWNLOAD_FAILED', 'Der Download konnte nicht gestartet werden.');
    }
    if (response.status >= 300 && response.status < 400) {
      void response.body?.cancel().catch(() => undefined);
      const location = response.headers.get('location');
      if (location === null || hop >= MAX_REDIRECTS) {
        throw new AppError(502, 'DOWNLOAD_FAILED', 'Zu viele oder ungültige Weiterleitungen beim Download.');
      }
      url = assertAllowedUrl(new URL(location, url).href, allowedHosts);
      continue;
    }
    return response;
  }
}

async function openStream(spec: DownloadSpec, options: DownloaderOptions): Promise<Response> {
  const response = await fetchAllowed(spec.url, spec.allowedHosts ?? options.allowedHosts, options);
  if (!response.ok || response.body === null) {
    void response.body?.cancel().catch(() => undefined);
    throw new AppError(502, 'DOWNLOAD_FAILED', `Der Download ist fehlgeschlagen (HTTP ${response.status}).`);
  }
  return response;
}

const mismatch = (): AppError =>
  new AppError(502, 'DOWNLOAD_HASH_MISMATCH', 'Die heruntergeladene Datei stimmt nicht mit der erwarteten Prüfsumme überein.');

async function assertZipMagic(file: string): Promise<void> {
  const handle = await open(file, 'r');
  try {
    const head = Buffer.alloc(ZIP_MAGIC.length);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    if (bytesRead !== head.length || !head.equals(ZIP_MAGIC)) {
      throw new AppError(502, 'DOWNLOAD_INVALID_FILE', 'Die heruntergeladene Datei ist kein gültiges Java-Archiv.');
    }
  } finally {
    await handle.close();
  }
}

export async function downloadToTmp(spec: DownloadSpec, tmpDir: string, options: DownloaderOptions): Promise<string> {
  sanitizeJarName(spec.fileName);
  await mkdir(tmpDir, { recursive: true });
  const response = await openStream(spec, options);
  const target = path.join(tmpDir, `${randomUUID()}.part`);
  const hash: Hash | null = spec.hash === undefined ? null : createHash(spec.hash.algorithm);
  const headerLength = Number(response.headers.get('content-length'));
  const total = spec.size ?? (Number.isFinite(headerLength) && headerLength > 0 ? headerLength : null);
  let received = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (spec.size !== undefined && received > spec.size) {
        callback(mismatch());
        return;
      }
      hash?.update(chunk);
      spec.onProgress?.(received, total);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), meter, createWriteStream(target));
    if (spec.size !== undefined && received !== spec.size) throw mismatch();
    if (spec.hash !== undefined && hash?.digest('hex') !== spec.hash.value.toLowerCase()) throw mismatch();
    if (spec.requireZip === true) await assertZipMagic(target);
    return target;
  } catch (error) {
    await removeQuietly(target);
    if (error instanceof AppError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOSPC') {
      throw new AppError(507, 'DISK_FULL', 'Auf dem Datenträger ist nicht genug Speicherplatz frei.');
    }
    if (isTimeoutError(error)) {
      throw new AppError(504, 'DOWNLOAD_TIMEOUT', 'Der Download hat zu lange gedauert.');
    }
    throw new AppError(502, 'DOWNLOAD_FAILED', 'Der Download wurde unterbrochen.');
  }
}
