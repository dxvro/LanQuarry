import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { parseTar, parseZip, readTarGz, readZip, tarChunks, writeTarGz, writeZip } from '../lib/archive.mjs';

let dir;
before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'cm-archive-'));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

const longDir = `craftmanager-0.1.0-linux-x64/app/node_modules/${'sehr-langer-ordnername-'.repeat(4)}/dist/${'x'.repeat(40)}`;
const entries = () => [
  { path: 'pkg', type: 'dir', mode: 0o755 },
  { path: 'pkg/install.sh', type: 'file', mode: 0o755, data: Buffer.from('#!/bin/sh\necho hi\n') },
  { path: 'pkg/readme.txt', type: 'file', mode: 0o644, data: Buffer.from('Grüße') },
  { path: 'pkg/leer.txt', type: 'file', mode: 0o644, data: Buffer.alloc(0) },
  { path: `${longDir}/datei-mit-langem-pfad.js`, type: 'file', mode: 0o644, data: Buffer.from('lang') },
  { path: 'pkg/größe/ä.txt', type: 'file', mode: 0o644, data: Buffer.from('umlaut') },
  { path: 'pkg/grosse.bin', type: 'file', mode: 0o644, data: Buffer.alloc(100_000, 7) },
];

test('tar: Rundlauf mit Rechten, langen Pfaden und Umlauten', async () => {
  const file = path.join(dir, 'a.tar.gz');
  await writeTarGz(file, entries(), 1_700_000_000);
  const read = await readTarGz(file);
  const byPath = new Map(read.map((e) => [e.path, e]));
  assert.equal(byPath.get('pkg/').type, 'dir');
  assert.equal(byPath.get('pkg/install.sh').mode & 0o777, 0o755);
  assert.equal(byPath.get('pkg/readme.txt').mode & 0o777, 0o644);
  assert.equal(byPath.get('pkg/readme.txt').data.toString('utf8'), 'Grüße');
  assert.equal(byPath.get(`${longDir}/datei-mit-langem-pfad.js`).data.toString(), 'lang');
  assert.equal(byPath.get('pkg/größe/ä.txt').data.toString(), 'umlaut');
  assert.equal(byPath.get('pkg/grosse.bin').data.length, 100_000);
  assert.equal(byPath.get('pkg/leer.txt').data.length, 0);
});

test('tar: Ausgabe ist reproduzierbar (gleiche Eingabe, gleiche Bytes)', async () => {
  const collect = async () => {
    const chunks = [];
    for await (const chunk of tarChunks(entries(), 1_700_000_000)) chunks.push(chunk);
    return Buffer.concat(chunks);
  };
  assert.deepEqual(await collect(), await collect());
});

test('tar: Das System-tar liest das Archiv und zeigt Ausführrechte', async (t) => {
  if (spawnSync('tar', ['--version']).status !== 0) return t.skip('kein tar vorhanden');
  const file = path.join(dir, 'b.tar.gz');
  await writeTarGz(file, entries(), 1_700_000_000);
  const listing = spawnSync('tar', ['-tvzf', path.basename(file)], { encoding: 'utf8', cwd: dir });
  assert.equal(listing.status, 0, listing.stderr);
  const line = listing.stdout.split('\n').find((l) => l.trim().endsWith('pkg/install.sh'));
  assert.match(line, /^-rwxr-xr-x/);
  assert.match(listing.stdout, /datei-mit-langem-pfad\.js/);
});

test('tar: leere Eingabe ergibt keine Einträge', () => {
  assert.deepEqual(parseTar(Buffer.alloc(1024)), []);
});

test('zip: Rundlauf mit Rechten und Inhalt', async () => {
  const file = path.join(dir, 'a.zip');
  await writeZip(file, entries());
  const read = await readZip(file);
  const byPath = new Map(read.map((e) => [e.path, e]));
  assert.equal(byPath.get('pkg/').type, 'dir');
  assert.equal(byPath.get('pkg/install.sh').mode & 0o777, 0o755);
  assert.equal(byPath.get('pkg/readme.txt').data.toString('utf8'), 'Grüße');
  assert.equal(byPath.get('pkg/grosse.bin').data.length, 100_000);
  assert.equal(byPath.get('pkg/leer.txt').data.length, 0);
  assert.equal(byPath.get('pkg/größe/ä.txt').data.toString(), 'umlaut');
});

test('zip: Das System-tar (bsdtar) liest das Archiv', async (t) => {
  const file = path.join(dir, 'c.zip');
  await writeZip(file, entries());
  // unter Windows bsdtar aus System32 (liest ZIP), das tar aus Git Bash kann es nicht
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  const attempt = spawnSync(tar, ['-tf', path.basename(file)], { encoding: 'utf8', cwd: dir });
  if (attempt.status !== 0) return t.skip('kein zip-fähiges tar vorhanden');
  assert.match(attempt.stdout, /pkg\/install\.sh/);
});

test('zip: ungültige Datei wird abgelehnt', () => {
  assert.throws(() => parseZip(Buffer.from('kein zip')), /Kein gueltiges ZIP/);
});

test('Dateien von der Platte werden gelesen', async () => {
  const file = path.join(dir, 'd.bin');
  await writeFile(file, 'x');
  const out = path.join(dir, 'd.tar.gz');
  await writeTarGz(out, [{ path: 'd.bin', type: 'file', mode: 0o644, file }], 0);
  assert.equal((await readTarGz(out))[0].data.toString(), 'x');
});
