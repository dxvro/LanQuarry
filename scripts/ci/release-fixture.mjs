#!/usr/bin/env node
// Legt SHA256SUMS.txt für alle Dateien eines Release-Ordners an und signiert sie (CI-Test mit Wegwerf-Schlüssel).
//   node scripts/ci/release-fixture.mjs --dir gh/v0.1.1 --key ci-private.pem --pub ci-public.pem
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { main as sign } from '../sign-release.mjs';

const { values } = parseArgs({ options: { dir: { type: 'string' }, key: { type: 'string' }, pub: { type: 'string' } }, strict: true });
if (values.dir === undefined || values.key === undefined || values.pub === undefined) {
  console.error('Verwendung: release-fixture.mjs --dir <Ordner> --key <private.pem> --pub <public.pem>');
  process.exit(2);
}
const lines = [];
for (const name of (await readdir(values.dir)).sort()) {
  if (name.startsWith('SHA256SUMS') || name === 'release.json') continue;
  lines.push(`${createHash('sha256').update(await readFile(path.join(values.dir, name))).digest('hex')}  ${name}`);
}
const sums = path.join(values.dir, 'SHA256SUMS.txt');
await writeFile(sums, `${lines.join('\n')}\n`);
await sign(['--sums', sums, '--key-file', values.key, '--trusted-pub', values.pub]);
