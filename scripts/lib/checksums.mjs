import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

// SHASUMS256.txt: "<64 Hex-Zeichen>  <Dateiname>" je Zeile
export function parseShasums(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(trimmed);
    if (match === null) throw new Error(`Ungueltige Zeile in SHASUMS256.txt: „${trimmed.slice(0, 80)}“`);
    map.set(match[2].trim(), match[1].toLowerCase());
  }
  return map;
}

export function lookupShasum(map, fileName) {
  const hash = map.get(fileName);
  if (hash === undefined) throw new Error(`Keine Pruefsumme fuer ${fileName} in SHASUMS256.txt.`);
  return hash;
}

export function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

// npm-Integritaet: "sha512-<base64>" (auch sha256/sha384/sha1); mehrere durch Leerzeichen getrennt
export function verifyIntegrity(buffer, integrity) {
  const entries = integrity.trim().split(/\s+/);
  for (const entry of entries) {
    const match = /^(sha1|sha256|sha384|sha512)-(.+)$/.exec(entry);
    if (match === null) continue;
    const digest = createHash(match[1]).update(buffer).digest('base64');
    if (digest === match[2]) return true;
  }
  return false;
}
