import { createReadStream } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { crc32, createInflateRaw } from 'node:zlib';
import { AppError } from '../http/errors.js';
import { isRootEntry, unsafeEntry } from './safe-path.js';
import { ExtractionGuard, writeExtractedFile, type ExtractOptions, type ExtractReport } from './tar.js';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_COMMENT = 0xffff;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;

const corrupt = (): AppError => new AppError(422, 'ARCHIVE_CORRUPT', 'Das Archiv ist beschädigt oder unvollständig.');

export interface ZipEntry {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
  mode: number;
  directory: boolean;
}

async function readAt(handle: Awaited<ReturnType<typeof open>>, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) throw corrupt();
  return buffer;
}

export async function readDirectory(archive: string): Promise<ZipEntry[]> {
  const handle = await open(archive, 'r');
  try {
    const { size } = await handle.stat();
    const tailLength = Math.min(size, 22 + MAX_COMMENT);
    const tail = await readAt(handle, size - tailLength, tailLength);
    let eocd = -1;
    for (let offset = tail.length - 22; offset >= 0; offset--) {
      if (tail.readUInt32LE(offset) === EOCD_SIGNATURE) {
        eocd = offset;
        break;
      }
    }
    if (eocd === -1) throw corrupt();
    let total = tail.readUInt16LE(eocd + 10);
    let directorySize = tail.readUInt32LE(eocd + 12);
    let directoryOffset = tail.readUInt32LE(eocd + 16);
    if (total === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
      // ZIP64: the locator sits right before the end record and points at the ZIP64 end record
      const locatorAt = size - tailLength + eocd - 20;
      if (locatorAt < 0) throw corrupt();
      const locator = await readAt(handle, locatorAt, 20);
      if (locator.readUInt32LE(0) !== ZIP64_LOCATOR_SIGNATURE) throw corrupt();
      const recordAt = Number(locator.readBigUInt64LE(8));
      if (!Number.isSafeInteger(recordAt) || recordAt + 56 > size) throw corrupt();
      const record = await readAt(handle, recordAt, 56);
      if (record.readUInt32LE(0) !== ZIP64_EOCD_SIGNATURE) throw corrupt();
      total = Number(record.readBigUInt64LE(32));
      directorySize = Number(record.readBigUInt64LE(40));
      directoryOffset = Number(record.readBigUInt64LE(48));
      if (![total, directorySize, directoryOffset].every(Number.isSafeInteger)) throw corrupt();
    }
    if (directoryOffset + directorySize > size) throw corrupt();
    const directory = await readAt(handle, directoryOffset, directorySize);
    const entries: ZipEntry[] = [];
    let offset = 0;
    for (let index = 0; index < total; index++) {
      if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== CENTRAL_SIGNATURE) throw corrupt();
      const madeBy = directory.readUInt16LE(offset + 4);
      const flags = directory.readUInt16LE(offset + 8);
      const nameLength = directory.readUInt16LE(offset + 28);
      const extraLength = directory.readUInt16LE(offset + 30);
      const commentLength = directory.readUInt16LE(offset + 32);
      if ((flags & 1) !== 0) throw new AppError(422, 'ARCHIVE_UNSUPPORTED', 'Verschlüsselte Archive werden nicht unterstützt.');
      const name = directory.toString('utf8', offset + 46, offset + 46 + nameLength);
      const attributes = directory.readUInt32LE(offset + 38);
      let compressedSize = directory.readUInt32LE(offset + 20);
      let entrySize = directory.readUInt32LE(offset + 24);
      let localOffset = directory.readUInt32LE(offset + 42);
      if (compressedSize === 0xffffffff || entrySize === 0xffffffff || localOffset === 0xffffffff) {
        // ZIP64 extra field: only the values that overflowed are present, in this fixed order
        const extra = directory.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraLength);
        let at = 0;
        let found = false;
        while (at + 4 <= extra.length) {
          const id = extra.readUInt16LE(at);
          const length = extra.readUInt16LE(at + 2);
          if (id === 1) {
            let cursor = at + 4;
            const take = (): number => {
              if (cursor + 8 > at + 4 + length) throw corrupt();
              const value = Number(extra.readBigUInt64LE(cursor));
              cursor += 8;
              if (!Number.isSafeInteger(value)) throw corrupt();
              return value;
            };
            if (entrySize === 0xffffffff) entrySize = take();
            if (compressedSize === 0xffffffff) compressedSize = take();
            if (localOffset === 0xffffffff) localOffset = take();
            found = true;
            break;
          }
          at += 4 + length;
        }
        if (!found) throw corrupt();
      }
      entries.push({
        name,
        method: directory.readUInt16LE(offset + 10),
        crc: directory.readUInt32LE(offset + 16),
        compressedSize,
        size: entrySize,
        localOffset,
        mode: madeBy >> 8 === 3 ? attributes >>> 16 : 0,
        directory: name.endsWith('/'),
      });
      offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  } finally {
    await handle.close();
  }
}

export async function dataStart(archive: string, entry: ZipEntry): Promise<number> {
  const handle = await open(archive, 'r');
  try {
    const head = await readAt(handle, entry.localOffset, 30);
    if (head.readUInt32LE(0) !== LOCAL_SIGNATURE) throw corrupt();
    return entry.localOffset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  } finally {
    await handle.close();
  }
}

export async function extractZip(archive: string, root: string, options: ExtractOptions): Promise<ExtractReport> {
  const guard = new ExtractionGuard(root, options);
  await mkdir(root, { recursive: true });
  const entries = await readDirectory(archive);
  for (const entry of entries) {
    const kind = entry.mode & 0o170000;
    if (kind === 0o120000) throw unsafeEntry(entry.name, 'Symlinks sind nicht erlaubt');
    if (entry.directory && isRootEntry(entry.name)) continue;
    if (entry.directory) {
      guard.count(0);
      const { target } = guard.resolve(entry.name);
      await mkdir(target, { recursive: true });
      continue;
    }
    if (entry.method !== 0 && entry.method !== 8) throw new AppError(422, 'ARCHIVE_UNSUPPORTED', 'Das Archiv verwendet ein nicht unterstütztes Kompressionsverfahren.');
    guard.count(entry.size);
    const { target } = guard.resolve(entry.name);
    const start = await dataStart(archive, entry);
    let checksum = 0;
    await writeExtractedFile(guard, target, entry.size, entry.mode, async (sink) => {
      if (entry.compressedSize === 0) return;
      const raw = createReadStream(archive, { start, end: start + entry.compressedSize - 1 });
      const stream = entry.method === 8 ? raw.pipe(createInflateRaw()) : raw;
      raw.on('error', (error) => stream.destroy(error));
      try {
        for await (const chunk of stream) {
          const data = chunk as Buffer;
          checksum = crc32(data, checksum);
          await sink(data);
        }
      } catch (error) {
        raw.destroy();
        if (error instanceof AppError) throw error;
        if ((error as NodeJS.ErrnoException).code?.startsWith('Z_') === true) throw corrupt();
        throw error;
      }
    });
    if (checksum !== entry.crc) throw corrupt();
  }
  return { entries: guard.entries, bytes: guard.bytes };
}
