import { statfs } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../http/errors.js';

export type FreeSpaceReader = (dir: string) => Promise<number | null>;

// Free bytes for the volume holding `dir` (or its nearest existing parent); null when the platform cannot tell
export const freeBytes: FreeSpaceReader = async (dir) => {
  let current = path.resolve(dir);
  for (;;) {
    try {
      const info = await statfs(current);
      return Number(info.bavail) * Number(info.bsize);
    } catch (error) {
      const parent = path.dirname(current);
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || parent === current) return null;
      current = parent;
    }
  }
};

const mib = (bytes: number): string => `${Math.ceil(bytes / (1024 * 1024)).toLocaleString('en-US')} MB`;

// What the space is needed for: a stable key for translations (params.purpose of DISK_FULL) and the English phrase
export type DiskPurpose = 'backup' | 'restore' | 'export' | 'upload' | 'world-replace' | 'archive-extract' | 'java';

const PURPOSE_TEXT: Record<DiskPurpose, string> = {
  backup: 'the backup',
  restore: 'the restore',
  export: 'the export',
  upload: 'the upload',
  'world-replace': 'replacing the world',
  'archive-extract': 'extracting the archive',
  java: 'the Java installation',
};

export async function assertFreeSpace(read: FreeSpaceReader, dir: string, neededBytes: number, purpose: DiskPurpose, java?: number): Promise<void> {
  const free = await read(dir);
  if (free === null || free >= neededBytes) return;
  const needed = Math.ceil(neededBytes / (1024 * 1024));
  const available = Math.ceil(free / (1024 * 1024));
  throw new AppError(
    507,
    'DISK_FULL',
    `Not enough free disk space for ${java === undefined ? PURPOSE_TEXT[purpose] : `Java ${java}`}: about ${mib(neededBytes)} needed, ${mib(free)} free.`,
    { neededBytes, freeBytes: free },
    { purpose, neededMb: needed, freeMb: available, ...(java === undefined ? {} : { major: java }) },
  );
}
