// Tests des privilegierten Updaters (installer/common/updater.mjs): Prüfung der Anfrage, Vertrauenskette, Ablauf mit Rollback.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  compareSemver,
  copyRegularFile,
  createContext,
  decodeSignature,
  expectedAssetName,
  isNewerVersion,
  parseSemver,
  parseSums,
  processRequest,
  reregisterWindowsService,
  stageRequest,
  taskXml,
  validateRequest,
  verifySumsSignature,
  waitForVersion,
} from '../../installer/common/updater.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

function newKeys() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { privateKey, publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
}

// A complete world: installed 0.1.0 (linux-x64) with its keys, and a request for the given version in request/
async function world({ target = 'linux-x64', version = '0.2.0', installed = '0.1.0', mutate = {} } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cm-updater-'));
  const keys = newKeys();
  const installDir = path.join(root, 'opt');
  await mkdir(path.join(installDir, 'tools'), { recursive: true });
  await writeFile(path.join(installDir, 'VERSION'), `${installed}\n`);
  await writeFile(path.join(installDir, 'version.json'), JSON.stringify({ target, version: installed }));
  await writeFile(path.join(installDir, 'tools', 'update-keys.json'), JSON.stringify({ keys: [{ id: 't', publicKey: keys.publicPem }] }));
  await writeFile(path.join(installDir, 'marker.txt'), 'alt');
  const updateRoot = path.join(root, 'upd');
  const requestDir = path.join(updateRoot, 'request');
  await mkdir(requestDir, { recursive: true });
  const assetName = expectedAssetName(version, target);
  const asset = Buffer.from(`paket ${version}`);
  const sums = Buffer.from(`${sha256(asset)}  ${assetName}\n`);
  const signer = mutate.signWith ?? keys;
  const files = {
    [assetName]: mutate.asset ?? asset,
    'SHA256SUMS.txt': mutate.sums ?? sums,
    'SHA256SUMS.txt.sig': mutate.sig ?? Buffer.from(`${sign(null, sums, signer.privateKey).toString('base64')}\n`),
  };
  for (const [name, bytes] of Object.entries(files)) await writeFile(path.join(requestDir, name), bytes);
  const request = { schema: 1, id: 'req-12345678', version, from: installed, assetName: mutate.assetName ?? assetName, requestedAt: 1, ...mutate.request };
  await writeFile(path.join(requestDir, 'request.json'), mutate.requestRaw ?? JSON.stringify(request));
  const logs = [];
  const ctx = createContext({
    platform: 'linux',
    updateRoot,
    installDir,
    configFile: path.join(root, 'craftmanager.env'),
    scriptPath: path.join(HERE, '..', '..', 'installer', 'common', 'updater.mjs'),
    log: (message) => logs.push(message),
    healthTimeoutMs: 50,
  });
  const status = async () => JSON.parse(await readFile(path.join(updateRoot, 'status.json'), 'utf8'));
  return { root, ctx, keys, installDir, updateRoot, requestDir, assetName, asset, status, logs, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('Updater: Versionsvergleich stimmt mit den gemeinsamen Testfällen überein', async () => {
  const cases = JSON.parse(await readFile(path.join(HERE, 'semver-cases.json'), 'utf8'));
  for (const [a, b, expected] of cases) {
    assert.equal(compareSemver(parseSemver(a), parseSemver(b)), expected, `${a} <=> ${b}`);
    assert.equal(isNewerVersion(a, b), expected > 0, `${a} > ${b}`);
  }
  assert.equal(parseSemver('1.2'), null);
  assert.equal(parseSemver('01.2.3'), null);
});

test('Updater: Signatur, Prüfsummen und Dateinamen', () => {
  const keys = newKeys();
  const sums = Buffer.from(`${'a'.repeat(64)}  craftmanager-0.2.0-linux-x64.tar.gz\r\n`);
  const sig = sign(null, sums, keys.privateKey).toString('base64');
  assert.ok(verifySumsSignature(sums, sig, [{ publicKey: keys.publicPem }]));
  assert.ok(!verifySumsSignature(Buffer.concat([sums, Buffer.from('x')]), sig, [{ publicKey: keys.publicPem }]));
  assert.ok(!verifySumsSignature(sums, sig, [{ publicKey: newKeys().publicPem }]));
  assert.ok(!verifySumsSignature(sums, sig, [{ publicKey: 'kein pem' }]));
  assert.equal(decodeSignature('abc'), null);
  assert.equal(parseSums(sums.toString()).get('craftmanager-0.2.0-linux-x64.tar.gz'), 'a'.repeat(64));
  assert.throws(() => parseSums('Quatsch'), /fehlerhaft/);
  assert.equal(expectedAssetName('1.0.0', 'win-x64'), 'craftmanager-1.0.0-setup.exe');
  assert.equal(expectedAssetName('1.0.0', 'linux-arm64'), 'craftmanager-1.0.0-linux-arm64.tar.gz');
  assert.equal(expectedAssetName('1.0.0', 'mac'), null);
});

test('Updater: Anfragen werden streng geprüft', () => {
  const ok = { schema: 1, id: 'abcd1234', version: '0.2.0', from: '0.1.0', assetName: 'craftmanager-0.2.0-setup.exe', requestedAt: 5 };
  assert.deepEqual(validateRequest(ok), { id: 'abcd1234', version: '0.2.0', from: '0.1.0', assetName: 'craftmanager-0.2.0-setup.exe' });
  for (const patch of [{ schema: 2 }, { id: '../x' }, { version: 'v0.2.0' }, { version: 'x' }, { assetName: '../craftmanager-0.2.0-setup.exe' }, { assetName: 'evil.exe' }, { requestedAt: -1 }]) {
    assert.throws(() => validateRequest({ ...ok, ...patch }), /Update-Anfrage/);
  }
  assert.throws(() => validateRequest(null), /ungültig/);
});

test('Updater: Kopieren mit Größenlimit, Hash über die Kopie und ohne Symlinks', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cm-copy-'));
  try {
    await mkdir(path.join(dir, 'in'));
    await writeFile(path.join(dir, 'in', 'a.bin'), 'hallo');
    const result = await copyRegularFile(path.join(dir, 'in'), 'a.bin', path.join(dir, 'out.bin'), 100);
    assert.deepEqual(result, { sha256: sha256('hallo'), size: 5 });
    await assert.rejects(copyRegularFile(path.join(dir, 'in'), 'a.bin', path.join(dir, 'out2.bin'), 3), /größer als erlaubt/);
    await assert.rejects(copyRegularFile(path.join(dir, 'in'), 'fehlt.bin', path.join(dir, 'out3.bin'), 100), /fehlt/);
    await assert.rejects(copyRegularFile(path.join(dir, 'in'), 'a.bin', path.join(dir, 'out.bin'), 100), /EEXIST/);
    try {
      await symlink(path.join(dir, 'in', 'a.bin'), path.join(dir, 'in', 'link.bin'));
      await assert.rejects(copyRegularFile(path.join(dir, 'in'), 'link.bin', path.join(dir, 'out4.bin'), 100), /keine normale Datei/);
    } catch (error) {
      if (error?.code !== 'EPERM') throw error; // Windows ohne Symlink-Recht
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Updater: eine gültige Anfrage wird in den Arbeitsordner übernommen, der Anfrageordner geleert', async () => {
  const w = await world();
  try {
    const staged = await stageRequest(w.ctx);
    assert.equal(staged.request.version, '0.2.0');
    assert.ok(staged.workDir.startsWith(path.join(w.updateRoot, 'work')));
    assert.equal(await readFile(staged.assetPath, 'utf8'), 'paket 0.2.0');
    assert.deepEqual(await readdir(w.requestDir), []);
  } finally {
    await w.cleanup();
  }
});

for (const [name, options, message] of [
  ['falscher Schlüssel', (w) => ({ signWith: newKeys() }), /Signatur/],
  ['veränderte Prüfsummen', () => ({ sums: Buffer.from(`${'0'.repeat(64)}  craftmanager-0.2.0-linux-x64.tar.gz\n`) }), /Signatur/],
  ['verändertes Paket', () => ({ asset: Buffer.from('böse') }), /Prüfsumme/],
  ['fehlende Signatur', () => ({ sig: Buffer.from('') }), /Signatur/],
  ['Paket für ein anderes System', () => ({ assetName: 'craftmanager-0.2.0-setup.exe' }), /passt nicht/],
  ['kaputtes JSON', () => ({ requestRaw: '{nicht json' }), /JSON/],
]) {
  test(`Updater lehnt ab: ${name}`, async () => {
    const w = await world({ mutate: options() });
    try {
      await assert.rejects(stageRequest(w.ctx), message);
      // der Anfrageordner ist leer, nichts bleibt im Arbeitsordner zurück
      assert.deepEqual(await readdir(w.requestDir), []);
      const work = path.join(w.updateRoot, 'work');
      assert.deepEqual(existsSync(work) ? await readdir(work) : [], []);
    } finally {
      await w.cleanup();
    }
  });
}

test('Updater lehnt ab: gleiche Version', async () => {
  const w = await world({ version: '0.1.0', installed: '0.1.0' });
  try {
    await assert.rejects(stageRequest(w.ctx), /nicht neuer/);
    assert.deepEqual(await readdir(w.requestDir), []);
  } finally {
    await w.cleanup();
  }
});

test('Updater: Zielsystem und Version kommen aus der Installation, nicht aus der Anfrage', async () => {
  // Anfrage nennt ein Windows-Paket, installiert ist Linux: abgelehnt, auch wenn alles korrekt signiert ist
  const w = await world({ target: 'linux-x64', mutate: { assetName: 'craftmanager-0.2.0-setup.exe' } });
  try {
    await assert.rejects(stageRequest(w.ctx), /passt nicht zu Version 0\.2\.0/);
  } finally {
    await w.cleanup();
  }
});

test('Updater: ein Symlink statt der Prüfsummen wird nicht gelesen', async (t) => {
  const w = await world();
  try {
    await rm(path.join(w.requestDir, 'SHA256SUMS.txt'));
    try {
      await symlink(path.join(w.installDir, 'VERSION'), path.join(w.requestDir, 'SHA256SUMS.txt'));
    } catch {
      return t.skip('Symlinks nicht erlaubt');
    }
    await assert.rejects(stageRequest(w.ctx), /keine normale Datei/);
  } finally {
    await w.cleanup();
  }
});

// ---- Ablauf (Linux) mit nachgebildeten Programmen ----------------------------------------------------------------

function fakeSystem(w, { newVersion = '0.2.0', installExit = 0, newWorks = true } = {}) {
  const state = { running: '0.1.0', calls: [], restored: false };
  const run = async (command, args) => {
    state.calls.push([path.basename(command), ...args].join(' '));
    const name = path.basename(command);
    if (name === 'tar') {
      const out = args[args.indexOf('-C') + 1];
      const pkg = path.join(out, 'craftmanager-0.2.0-linux-x64');
      await mkdir(pkg, { recursive: true });
      await writeFile(path.join(pkg, 'VERSION'), `${newVersion}\n`);
      await writeFile(path.join(pkg, 'version.json'), JSON.stringify({ target: 'linux-x64' }));
      await writeFile(path.join(pkg, 'install.sh'), '#!/bin/sh\n');
      return { code: 0, output: '' };
    }
    if (name === 'cp') {
      await cp(args[1], args[2], { recursive: true });
      if (args[2] === w.installDir) state.restored = true;
      return { code: 0, output: '' };
    }
    if (name === 'install.sh') {
      await writeFile(path.join(w.installDir, 'marker.txt'), 'neu');
      if (installExit === 0 && newWorks) state.running = '0.2.0';
      else state.running = 'kaputt';
      return { code: installExit, output: 'Installationsausgabe' };
    }
    if (name === 'systemctl' && args[0] === 'start' && state.restored) state.running = '0.1.0';
    return { code: 0, output: '' };
  };
  w.ctx.run = run;
  let tick = 0;
  w.ctx.now = () => (tick += 20);
  w.ctx.sleep = async () => undefined;
  w.ctx.fetch = async () => new Response(JSON.stringify({ status: 'ok', version: state.running }), { status: 200 });
  return state;
}

test('Updater (Linux): prüft, sichert, installiert, wartet auf die neue Version und meldet Erfolg', async () => {
  const w = await world();
  try {
    const state = fakeSystem(w);
    assert.equal(await processRequest(w.ctx), true);
    const status = await w.status();
    assert.equal(status.state, 'done');
    assert.equal(status.id, 'req-12345678');
    assert.match(status.message, /0\.2\.0/);
    assert.equal(await readFile(path.join(w.installDir, 'marker.txt'), 'utf8'), 'neu');
    // Reihenfolge: entpacken, sichern, dann erst installieren
    const order = state.calls.map((call) => call.split(' ')[0]);
    assert.deepEqual(order.slice(0, 3), ['tar', 'cp', 'install.sh']);
    assert.ok(state.calls[2].endsWith('--upgrade'));
    assert.ok(!existsSync(path.join(w.updateRoot, 'update.lock')));
    assert.deepEqual(existsSync(path.join(w.updateRoot, 'work')) ? await readdir(path.join(w.updateRoot, 'work')) : [], []);
  } finally {
    await w.cleanup();
  }
});

test('Updater (Linux): schlägt die Gesundheitsprüfung fehl, kommt die alte Version zurück', async () => {
  const w = await world();
  try {
    const state = fakeSystem(w, { newWorks: false });
    await processRequest(w.ctx);
    const status = await w.status();
    assert.equal(status.state, 'rolled-back');
    assert.match(status.message, /vorherige Version 0\.1\.0 läuft wieder/);
    assert.equal(await readFile(path.join(w.installDir, 'marker.txt'), 'utf8'), 'alt');
    assert.ok(state.calls.some((call) => call.startsWith('systemctl stop craftmanager.service')));
  } finally {
    await w.cleanup();
  }
});

test('Updater (Linux): scheitert install.sh, wird ebenfalls zurückgerollt', async () => {
  const w = await world();
  try {
    fakeSystem(w, { installExit: 1 });
    await processRequest(w.ctx);
    const status = await w.status();
    assert.equal(status.state, 'rolled-back');
    assert.match(status.message, /Installation ist fehlgeschlagen \(Code 1\)/);
    assert.equal(await readFile(path.join(w.installDir, 'marker.txt'), 'utf8'), 'alt');
  } finally {
    await w.cleanup();
  }
});

test('Updater (Linux): ein Paket mit falscher Version wird vor der Installation abgelehnt', async () => {
  const w = await world();
  try {
    const state = fakeSystem(w, { newVersion: '0.9.9' });
    await processRequest(w.ctx);
    assert.equal((await w.status()).state, 'failed');
    assert.match((await w.status()).message, /erwartet war 0\.2\.0/);
    assert.ok(!state.calls.some((call) => call.startsWith('install.sh')));
    assert.equal(await readFile(path.join(w.installDir, 'marker.txt'), 'utf8'), 'alt');
  } finally {
    await w.cleanup();
  }
});

test('Updater: abgelehnte Anfrage meldet failed mit der Kennung der Anfrage und installiert nichts', async () => {
  const w = await world({ mutate: { signWith: newKeys() } });
  try {
    const state = fakeSystem(w);
    await processRequest(w.ctx);
    const status = await w.status();
    assert.equal(status.state, 'failed');
    assert.equal(status.id, 'req-12345678');
    assert.match(status.message, /Signatur/);
    assert.deepEqual(state.calls, []);
  } finally {
    await w.cleanup();
  }
});

test('Updater: ohne Anfrage passiert nichts', async () => {
  const w = await world();
  try {
    await rm(path.join(w.requestDir, 'request.json'));
    assert.equal(await processRequest(w.ctx), false);
    assert.ok(!existsSync(path.join(w.updateRoot, 'status.json')));
  } finally {
    await w.cleanup();
  }
});

test('Updater: Gesundheitsprüfung erkennt die erwartete Version und sendet das Token nur an die Schleife', async () => {
  const w = await world();
  try {
    await writeFile(w.ctx.configFile, "PORT='4321'\nAUTH_TOKEN='tok-12345678'\nHOST='0.0.0.0'\n");
    const seen = [];
    w.ctx.fetch = async (url, init) => {
      seen.push([String(url), init.headers.Authorization]);
      return new Response(JSON.stringify({ status: 'ok', version: '0.2.0' }));
    };
    assert.deepEqual(await waitForVersion(w.ctx, '0.2.0'), { ok: true });
    assert.deepEqual(seen, [['http://127.0.0.1:4321/api/health', 'Bearer tok-12345678']]);
    w.ctx.fetch = async () => new Response(JSON.stringify({ status: 'ok' }));
    w.ctx.sleep = async () => undefined;
    let t = 0;
    w.ctx.now = () => (t += 40);
    const result = await waitForVersion(w.ctx, '0.2.0');
    assert.equal(result.ok, false);
  } finally {
    await w.cleanup();
  }
});

test('Updater: Gesundheitsprüfung folgt dem geänderten Port aus network.json, aber nur zu Adressen dieses Rechners', async () => {
  const w = await world();
  try {
    const dataDir = path.join(path.dirname(w.ctx.configFile), 'data');
    await mkdir(dataDir, { recursive: true });
    await writeFile(w.ctx.configFile, `PORT='3000'
HOST='0.0.0.0'
AUTH_TOKEN='tok-12345678'
DATA_DIR='${dataDir}'
`);
    const seen = [];
    w.ctx.fetch = async (url) => {
      seen.push(String(url));
      return new Response(JSON.stringify({ status: 'ok', version: '0.2.0' }));
    };
    await writeFile(path.join(dataDir, 'network.json'), JSON.stringify({ host: '0.0.0.0', port: 3555, probeHost: '127.0.0.1' }));
    assert.deepEqual(await waitForVersion(w.ctx, '0.2.0'), { ok: true });
    // fremde Adresse in der Datei: das Token geht nicht dorthin, es gilt die Konfiguration
    await writeFile(path.join(dataDir, 'network.json'), JSON.stringify({ host: '0.0.0.0', port: 3556, probeHost: '203.0.113.9' }));
    assert.deepEqual(await waitForVersion(w.ctx, '0.2.0'), { ok: true });
    await writeFile(path.join(dataDir, 'network.json'), 'kein json');
    assert.deepEqual(await waitForVersion(w.ctx, '0.2.0'), { ok: true });
    assert.deepEqual(seen, ['http://127.0.0.1:3555/api/health', 'http://127.0.0.1:3000/api/health', 'http://127.0.0.1:3000/api/health']);
  } finally {
    await w.cleanup();
  }
});

test('Updater (Windows): Aufgabe läuft als SYSTEM, Pfade mit Leerzeichen bleiben in den Argumenten heil', () => {
  const xml = taskXml('C:\\ProgramData\\LocalMC CraftManager Update\\work\\x\\runner\\node.exe', '"C:\\a b\\updater.mjs" install-job --job "C:\\a b\\job.json"');
  assert.match(xml, /<UserId>S-1-5-18<\/UserId>/);
  assert.match(xml, /<Command>C:\\ProgramData\\LocalMC CraftManager Update\\work\\x\\runner\\node\.exe<\/Command>/);
  assert.match(xml, /<Arguments>&quot;C:\\a b\\updater\.mjs&quot; install-job --job &quot;C:\\a b\\job\.json&quot;<\/Arguments>/);
  assert.ok(!/<(Time|Calendar|Boot|Logon)Trigger/.test(xml), 'keine automatischen Auslöser');
});

test('Updater (Windows): Übergabe an die Aufgabenplanung legt eine Kopie an und startet die Aufgabe einmalig', async () => {
  const w = await world({ target: 'win-x64' });
  try {
    await mkdir(path.join(w.installDir, 'node'), { recursive: true });
    await writeFile(path.join(w.installDir, 'node', 'node.exe'), 'node');
    const calls = [];
    w.ctx.platform = 'win32';
    w.ctx.run = async (command, args) => {
      calls.push([path.basename(command).toLowerCase(), ...args]);
      return { code: 0, output: '' };
    };
    await processRequest(w.ctx);
    const names = calls.map((call) => `${call[0]} ${call[1]}`);
    assert.ok(names.includes('schtasks.exe /Create'));
    assert.ok(names.includes('schtasks.exe /Run'));
    const job = JSON.parse(await readFile(path.join(w.updateRoot, 'work', 'req-12345678', 'job.json'), 'utf8'));
    assert.equal(job.version, '0.2.0');
    assert.equal(job.from, '0.1.0');
    assert.ok(job.setup.endsWith('craftmanager-0.2.0-setup.exe'));
    assert.ok(existsSync(path.join(w.updateRoot, 'work', 'req-12345678', 'runner', 'node.exe')));
    assert.ok(existsSync(path.join(w.updateRoot, 'work', 'req-12345678', 'runner', 'updater.mjs')));
    // die Sperre bleibt bei der Aufgabe, die Arbeitsdateien auch
    assert.ok(existsSync(path.join(w.updateRoot, 'update.lock')));
  } finally {
    await w.cleanup();
  }
});

test('Windows-Installer: Rechte mit NT SERVICE\craftmanager werden erst nach der Registrierung der Dienste gesetzt (icacls 1332)', async () => {
  const iss = (await readFile(new URL('../../installer/windows/craftmanager.iss', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const steps = iss.slice(iss.indexOf('procedure CurStepChanged'));
  const order = ['RegisterService;', 'RegisterUpdater;', 'PrepareUpdateFolders;', 'SecureFolderAndFiles;', 'CreateConfig;', 'SecureConfigFiles;'].map((name) => steps.indexOf(name));
  assert.ok(order.every((index) => index > 0), 'alle Schritte kommen in CurStepChanged vor');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'Registrierung vor allen icacls-Aufrufen mit dem Dienstkonto');
  // kein icacls-Aufruf mit dem Dienstkonto an RunIcacls (Wiederholung bei 1332) vorbei
  assert.ok(!/RunTool\(Icacls/.test(iss));
});

const TOOL = path.join(os.tmpdir(), 'tool.exe');
const ACCOUNT = ['NT SERVICE', 'craftmanager'].join(String.fromCharCode(92));

test('Windows: kein WinSW-Befehl "refresh" (gibt es erst in WinSW 3, das Paket bringt 2.12)', async () => {
  const iss = await readFile(new URL('../../installer/windows/craftmanager.iss', import.meta.url), 'utf8');
  const updater = await readFile(new URL('../../installer/common/updater.mjs', import.meta.url), 'utf8');
  assert.ok(!/'refresh'/.test(iss) && !/'refresh'/.test(updater));
  // Reihenfolge im Installer: entfernen, warten bis der Dienst weg ist, erst dann neu eintragen
  const reregister = iss.slice(iss.indexOf('function ReregisterService'), iss.indexOf('procedure RegisterService'));
  const order = ["'uninstall'", 'WaitForServiceGone(Name)', 'InstallServiceWithRetry(Tool)'].map((text) => reregister.indexOf(text));
  assert.ok(order.every((index) => index > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test('Updater (Windows): Dienst wird mit Wartezeit neu eingetragen (zum Löschen markiert, install schlägt zunächst fehl)', async () => {
  const w = await world({ target: 'win-x64' });
  try {
    const calls = [];
    let queries = 0;
    let installs = 0;
    w.ctx.sleep = async () => undefined;
    w.ctx.run = async (command, args) => {
      const name = path.basename(command).toLowerCase();
      calls.push(`${name} ${args.join(' ')}`);
      if (name === 'sc.exe' && args[0] === 'query') return { code: ++queries <= 3 ? 0 : 1060, output: '' };
      if (name === 'tool.exe' && args[0] === 'install') return { code: ++installs < 3 ? -1 : 0, output: '' };
      return { code: 0, output: '' };
    };
    assert.equal(await reregisterWindowsService(w.ctx, TOOL, 'craftmanager', ACCOUNT), true);
    const steps = calls.map((call) => call.replace(/\s+$/, ''));
    assert.deepEqual(steps.filter((c) => !c.startsWith('sc.exe query')), [
      'net.exe stop craftmanager',
      'tool.exe uninstall',
      'tool.exe install',
      'tool.exe install',
      'tool.exe install',
      `sc.exe config craftmanager obj= ${ACCOUNT}`,
    ]);
    assert.ok(calls.indexOf('tool.exe uninstall') < calls.lastIndexOf('sc.exe query craftmanager'));
    assert.ok(!calls.some((call) => call.includes('refresh')));
  } finally {
    await w.cleanup();
  }
});

test('Updater (Windows): fehlt der Dienst, wird nur eingetragen', async () => {
  const w = await world({ target: 'win-x64' });
  try {
    const calls = [];
    w.ctx.sleep = async () => undefined;
    w.ctx.run = async (command, args) => {
      calls.push(`${path.basename(command).toLowerCase()} ${args.join(' ')}`);
      return { code: args[0] === 'query' ? 1060 : 0, output: '' };
    };
    assert.equal(await reregisterWindowsService(w.ctx, TOOL, 'craftmanager-updater', 'LocalSystem'), true);
    assert.ok(!calls.some((call) => call.startsWith('tool.exe uninstall')));
    assert.ok(calls.includes('tool.exe install') && calls.includes('sc.exe config craftmanager-updater obj= LocalSystem'));
  } finally {
    await w.cleanup();
  }
});
