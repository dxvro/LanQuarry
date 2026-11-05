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

const mib = (bytes: number): string => `${Math.ceil(bytes / (1024 * 1024)).toLocaleString('de-DE')} MB`;

export async function assertFreeSpace(read: FreeSpaceReader, dir: string, neededBytes: number, purpose: string): Promise<void> {
  const free = await read(dir);
  if (free === null || free >= neededBytes) return;
  throw new AppError(
    507,
    'DISK_FULL',
    `Nicht genug freier Speicherplatz für ${purpose}: benötigt werden etwa ${mib(neededBytes)}, frei sind ${mib(free)}.`,
    { neededBytes, freeBytes: free },
  );
}
