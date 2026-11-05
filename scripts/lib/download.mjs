import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { sha256File } from './checksums.mjs';

// Kein persönlicher Eintrag (keine E-Mail-Adresse) im User-Agent
const USER_AGENT = 'LocalMC-CraftManager-Packager';
const MAX_REDIRECTS = 5;

// Prüft jede Adresse (auch jede Weiterleitung) gegen die erlaubten Hosts; nur https.
export function assertAllowedUrl(url, allowedHosts) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error(`Nur https ist erlaubt: ${url}`);
  const host = parsed.hostname.toLowerCase();
  const ok = allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  if (!ok) throw new Error(`Host ${host} ist für Downloads nicht erlaubt (${allowedHosts.join(', ')}).`);
  return parsed;
}

async function open(url, allowedHosts) {
  let current = url;
  for (let i = 0; i <= MAX_REDIRECTS; i += 1) {
    assertAllowedUrl(current, allowedHosts);
    const response = await fetch(current, { redirect: 'manual', headers: { 'user-agent': USER_AGENT } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location === null) throw new Error(`Weiterleitung ohne Ziel: ${current}`);
      current = new URL(location, current).href;
      continue;
    }
    if (!response.ok || response.body === null) throw new Error(`Download fehlgeschlagen (${response.status}): ${current}`);
    return response;
  }
  throw new Error(`Zu viele Weiterleitungen: ${url}`);
}

export async function fetchText(url, allowedHosts) {
  const response = await open(url, allowedHosts);
  return response.text();
}

// Lädt in den Cache (release/.cache), prüft SHA-256 und liefert den Pfad. Ein vorhandener Treffer im
// Cache wird nur verwendet, wenn seine Prüfsumme stimmt.
export async function downloadVerified({ url, allowedHosts, destination, sha256, label }) {
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    await stat(destination);
    if ((await sha256File(destination)) === sha256) {
      console.log(`  ${label}: aus dem Cache (${path.basename(destination)})`);
      return destination;
    }
    await rm(destination, { force: true });
  } catch {
    // nicht im Cache
  }
  console.log(`  ${label}: lade ${url}`);
  const response = await open(url, allowedHosts);
  const partial = `${destination}.part`;
  const hash = createHash('sha256');
  const source = Readable.fromWeb(response.body);
  source.on('data', (chunk) => hash.update(chunk));
  await pipeline(source, createWriteStream(partial));
  const actual = hash.digest('hex');
  if (actual !== sha256) {
    await rm(partial, { force: true });
    throw new Error(`Prüfsumme von ${label} stimmt nicht.\n  erwartet: ${sha256}\n  erhalten: ${actual}`);
  }
  await rename(partial, destination);
  console.log(`  ${label}: SHA-256 ok (${actual.slice(0, 16)}...)`);
  return destination;
}

export async function downloadBuffer(url, allowedHosts) {
  const response = await open(url, allowedHosts);
  return Buffer.from(await response.arrayBuffer());
}

export async function readJsonFile(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}
