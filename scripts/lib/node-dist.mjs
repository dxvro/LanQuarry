// Auswahl und Adressen der offiziellen Node.js-Laufzeit (reine Logik) und Rechte der entpackten Programmdatei.
import { chmod, writeFile } from 'node:fs/promises';

export const NODE_DIST_HOST = 'nodejs.org';
export const NODE_DIST_BASE = `https://${NODE_DIST_HOST}/dist`;

function compareVersions(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// index.json von nodejs.org/dist: neueste Version, die eine LTS-Linie ist
export function selectLts(index) {
  if (!Array.isArray(index)) throw new Error('Unerwartetes Format von nodejs.org/dist/index.json');
  const lts = index.filter((entry) => typeof entry?.version === 'string' && typeof entry.lts === 'string');
  if (lts.length === 0) throw new Error('Keine LTS-Version in index.json gefunden.');
  lts.sort((a, b) => compareVersions(b.version, a.version));
  return lts[0].version;
}

export function nodeDistUrl(version, fileName) {
  return `${NODE_DIST_BASE}/${version}/${fileName}`;
}

// Pfade innerhalb des offiziellen Archivs
export function nodeArchiveEntries(version, target) {
  const root = `node-${version}-${target.nodeDist}`;
  return target.platform === 'win32'
    ? { binary: `${root}/node.exe`, license: `${root}/LICENSE` }
    : { binary: `${root}/bin/node`, license: `${root}/LICENSE` };
}

// Dateirechte der entpackten Node-Programmdatei: tar liefert das Ausführbit mit, zip (Windows) braucht es nicht
export function nodeBinaryMode(entryMode, target) {
  if (target.platform === 'win32') return 0o755;
  // Ausführbit für alle sicherstellen, auch wenn der Archiveintrag keine Rechte trägt
  return ((entryMode & 0o777) | 0o755) & 0o777;
}

// Schreibt die Datei und setzt die Rechte danach noch einmal ausdrücklich (writeFile-mode unterliegt der umask)
export async function writeExecutable(file, data, mode) {
  await writeFile(file, data, { mode });
  await chmod(file, mode);
}
