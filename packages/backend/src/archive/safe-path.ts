import path from 'node:path';
import { AppError } from '../http/errors.js';

const WINDOWS_FORBIDDEN = /[<>:"|?*\u0000-\u001f]/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const MAX_ENTRY_PATH = 1024;

export const unsafeEntry = (entry: string, reason: string): AppError =>
  new AppError(422, 'ARCHIVE_UNSAFE', `Das Archiv enthält einen unzulässigen Eintrag „${entry.slice(0, 120)}“ (${reason}). Der Vorgang wurde abgebrochen.`);

// Splits an archive entry name into plain path segments. Anything that could leave the target folder
// (absolute paths, drive letters, "..", NUL bytes, characters Windows cannot store) is rejected.
export function entrySegments(name: string, platform: NodeJS.Platform = process.platform): string[] {
  if (name.length === 0 || name.length > MAX_ENTRY_PATH) throw unsafeEntry(name, 'ungültige Länge');
  if (name.includes('\u0000')) throw unsafeEntry(name, 'enthält ein Nullzeichen');
  const normalized = name.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) throw unsafeEntry(name, 'absoluter Pfad');
  const segments: string[] = [];
  for (const segment of normalized.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') throw unsafeEntry(name, 'Verweis auf ein übergeordnetes Verzeichnis');
    if (platform === 'win32') {
      if (WINDOWS_FORBIDDEN.test(segment) || WINDOWS_RESERVED.test(segment) || /[ .]$/.test(segment)) {
        throw unsafeEntry(name, 'unter Windows nicht speicherbar');
      }
    }
    segments.push(segment);
  }
  if (segments.length === 0) throw unsafeEntry(name, 'leerer Pfad');
  return segments;
}

// "./" and similar spellings of the archive root itself, which tar emits as the first entry
export const isRootEntry = (name: string): boolean => name.replaceAll('\\', '/').split('/').every((part) => part === '' || part === '.');

export interface EntryTarget {
  segments: string[];
  target: string;
}

export function resolveEntry(root: string, name: string, platform: NodeJS.Platform = process.platform): EntryTarget {
  const segments = entrySegments(name, platform);
  const base = path.resolve(root);
  const target = path.resolve(base, ...segments);
  if (target !== base && !target.startsWith(base + path.sep)) throw unsafeEntry(name, 'liegt außerhalb des Zielordners');
  return { segments, target };
}

// A symlink may only point at a path below the extraction root. ".." is only accepted as a prefix
// ("../x"), never after a normal segment, because "a/../x" would resolve differently if "a" is a link.
export function symlinkTargetInside(entrySegmentsOfLink: readonly string[], linkname: string): boolean {
  if (linkname === '' || linkname.includes('\u0000')) return false;
  const normalized = linkname.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return false;
  const parts = normalized.split('/').filter((part) => part !== '' && part !== '.');
  let depth = entrySegmentsOfLink.length - 1;
  let seenName = false;
  for (const part of parts) {
    if (part === '..') {
      if (seenName) return false;
      depth--;
      if (depth < 0) return false;
    } else {
      seenName = true;
      depth++;
    }
  }
  return true;
}
