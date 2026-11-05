import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { assertAllowedUrl } from '../lib/download.mjs';
import { formatNotices } from '../lib/notices.mjs';
import { machineMatches, readMachine } from '../lib/native.mjs';
import { WINSW } from '../lib/pins.mjs';
import { findNonAsciiPaths, isPrunableDirName, lockEntry, npmPlatformFlags, pruneNodeModules } from '../lib/stage.mjs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { getTarget, TARGET_NAMES } from '../lib/targets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('Download: nur https und nur erlaubte Hosts (auch für Weiterleitungen)', () => {
  assert.doesNotThrow(() => assertAllowedUrl('https://nodejs.org/dist/index.json', ['nodejs.org']));
  assert.doesNotThrow(() => assertAllowedUrl('https://release-assets.githubusercontent.com/x', ['github.com', 'githubusercontent.com']));
  assert.throws(() => assertAllowedUrl('http://nodejs.org/dist/index.json', ['nodejs.org']), /Nur https/);
  assert.throws(() => assertAllowedUrl('https://evil.example.com/node.zip', ['nodejs.org']), /nicht erlaubt/);
  assert.throws(() => assertAllowedUrl('https://nodejs.org.evil.com/x', ['nodejs.org']), /nicht erlaubt/);
  assert.throws(() => assertAllowedUrl('https://notnodejs.org/x', ['nodejs.org']), /nicht erlaubt/);
});

test('Native Bibliothek: ELF- und PE-Köpfe', () => {
  const elf = Buffer.alloc(64);
  elf.write('\x7fELF', 0, 'latin1');
  elf[5] = 1;
  elf.writeUInt16LE(0xb7, 18);
  assert.deepEqual(readMachine(elf), { format: 'elf', value: 0xb7 });
  assert.equal(machineMatches(readMachine(elf), getTarget('linux-arm64').machine), true);
  assert.equal(machineMatches(readMachine(elf), getTarget('linux-x64').machine), false);

  const pe = Buffer.alloc(256);
  pe.write('MZ', 0, 'latin1');
  pe.writeUInt32LE(0x80, 0x3c);
  pe.writeUInt32LE(0x00004550, 0x80);
  pe.writeUInt16LE(0x8664, 0x84);
  assert.equal(machineMatches(readMachine(pe), getTarget('win-x64').machine), true);
  assert.equal(readMachine(Buffer.from('nichts')), null);
});

test('npm-Plattformoptionen für das Zielsystem', () => {
  assert.deepEqual(npmPlatformFlags(getTarget('linux-arm64')), ['--os=linux', '--cpu=arm64', '--libc=glibc']);
  assert.deepEqual(npmPlatformFlags(getTarget('win-x64')), ['--os=win32', '--cpu=x64']);
});

test('package-lock.json enthält für jedes Ziel das libsql-Plattformpaket mit Prüfsumme', async () => {
  const lock = JSON.parse(await readFile(path.join(ROOT, 'package-lock.json'), 'utf8'));
  for (const name of TARGET_NAMES) {
    const entry = lockEntry(lock, getTarget(name).libsql);
    assert.match(entry.resolved, /^https:\/\/registry\.npmjs\.org\//);
    assert.match(entry.integrity, /^sha512-/);
  }
  assert.throws(() => lockEntry(lock, '@libsql/gibt-es-nicht'), /package-lock\.json/);
});

test('WinSW ist festgelegt: Version, https, SHA-256', () => {
  assert.match(WINSW.version, /^\d+\.\d+\.\d+$/);
  assert.match(WINSW.url, /^https:\/\/github\.com\/winsw\/winsw\/releases\/download\/v/);
  assert.match(WINSW.sha256, /^[0-9a-f]{64}$/);
  assert.ok(WINSW.url.includes(WINSW.version));
});

test('Hinweisdatei: listet Komponenten und Lizenztexte', () => {
  const text = formatNotices({
    productName: 'Test',
    packages: [
      { name: 'zod', version: '4.0.0', license: 'MIT', text: 'MIT-Text' },
      { name: 'ohne', version: '1', license: 'ISC', text: '' },
    ],
    extras: [{ name: 'Node.js', version: 'v26.13.0', license: 'MIT', text: 'Node-Lizenz' }],
  });
  for (const part of ['zod 4.0.0 (MIT)', 'MIT-Text', 'Node-Lizenz', 'Eclipse Temurin', 'keinen Lizenztext']) assert.ok(text.includes(part), part);
});

test('Skripte: Syntaxprüfung mit bash -n', (t) => {
  if (spawnSync('bash', ['--version']).status !== 0) return t.skip('bash nicht vorhanden');
  for (const file of ['install.sh', 'uninstall.sh']) {
    const result = spawnSync('bash', ['-n', path.join(ROOT, 'installer', 'linux', file)], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${file}: ${result.stderr}`);
  }
});

test('Dienst-Konfiguration: WinSW-Einstellungen für sauberes Beenden', async () => {
  const xml = await readFile(path.join(ROOT, 'installer', 'windows', 'craftmanager-service.xml'), 'utf8');
  const seconds = Number(/<stoptimeout>(\d+) sec<\/stoptimeout>/.exec(xml)?.[1]);
  assert.ok(seconds >= 160, `stoptimeout ${seconds}`);
  assert.match(xml, /<stopparentprocessfirst>true<\/stopparentprocessfirst>/);
  assert.match(xml, /@DATADIR@\\craftmanager\.env/);
  assert.ok(!/[^\x00-\x7f]/.test(xml), 'nur ASCII, weil der Installer die Datei als ANSI bearbeitet');
});

test('systemd-Einheit: Beenden und Härtung', async () => {
  const unit = await readFile(path.join(ROOT, 'installer', 'linux', 'craftmanager.service'), 'utf8');
  assert.match(unit, /^TimeoutStopSec=180$/m);
  assert.match(unit, /^Restart=on-failure$/m);
  assert.match(unit, /^KillMode=mixed$/m);
  assert.ok(!/^MemoryDenyWriteExecute=(true|yes)/m.test(unit), 'MemoryDenyWriteExecute würde Java stören');
  assert.match(unit, /^NoNewPrivileges=true$/m);
});

test('node_modules: Testordner werden entfernt, Sonderzeichen in Pfaden werden gefunden', async () => {
  assert.equal(isPrunableDirName('test'), true);
  assert.equal(isPrunableDirName('dist'), false);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cm-prune-'));
  try {
    await mkdir(path.join(dir, 'paket', 'test', 'fixtures', 'snow ☃'), { recursive: true });
    await mkdir(path.join(dir, 'paket', 'lib'), { recursive: true });
    await writeFile(path.join(dir, 'paket', 'lib', 'index.js'), '');
    assert.deepEqual((await findNonAsciiPaths(dir)).length, 1);
    assert.equal(await pruneNodeModules(dir), 1);
    assert.deepEqual(await findNonAsciiPaths(dir), []);
    assert.ok((await readFile(path.join(dir, 'paket', 'lib', 'index.js'), 'utf8')) === '');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
