// Signieren der Releases (scripts/sign-release.mjs) und Update-Dateien im Paket (scripts/lib/update-files.mjs)
import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { main as signMain, normalizePem, signSums } from '../sign-release.mjs';
import { parseEmbeddedKeys, readEmbeddedKeys, writeUpdateFiles } from '../lib/update-files.mjs';
import { parseArgs } from '../lib/targets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
}

async function temp(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cm-sign-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('Signieren: Signatur ist Ed25519 über die exakten Bytes und prüfbar', () => {
  const { privatePem, publicPem } = keypair();
  const sums = Buffer.from('abc  datei\r\n');
  const { signature } = signSums(sums, privatePem);
  assert.equal(signature.length, 64);
  assert.ok(verify(null, sums, createPublicKey(publicPem), signature));
  assert.ok(!verify(null, Buffer.from('abc  datei\n'), createPublicKey(publicPem), signature));
});

test('Signieren: Secrets ohne Zeilenumbrüche werden wieder zum gültigen PEM', () => {
  const { privatePem } = keypair();
  const flat = privatePem.replace(/\n/g, ' ');
  assert.equal(normalizePem(flat), privatePem);
  assert.throws(() => normalizePem('kein schlüssel'), /kein PEM/);
  assert.throws(() => signSums(Buffer.from('x'), generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' })), /Ed25519/);
});

test('Signieren: ohne Schlüssel bricht das Skript ab (kein Release ohne Signatur)', async () => {
  await temp(async (dir) => {
    await writeFile(path.join(dir, 'SHA256SUMS.txt'), 'x');
    const saved = process.env.UPDATE_SIGNING_KEY;
    delete process.env.UPDATE_SIGNING_KEY;
    try {
      await assert.rejects(signMain(['--sums', path.join(dir, 'SHA256SUMS.txt')]), /UPDATE_SIGNING_KEY ist nicht gesetzt/);
      process.env.UPDATE_SIGNING_KEY = '  ';
      await assert.rejects(signMain(['--sums', path.join(dir, 'SHA256SUMS.txt')]), /nicht gesetzt/);
    } finally {
      if (saved !== undefined) process.env.UPDATE_SIGNING_KEY = saved;
    }
  });
});

test('Signieren: ein Schlüssel, der nicht in keys.ts steht, wird abgelehnt', async () => {
  await temp(async (dir) => {
    const { privatePem } = keypair();
    await writeFile(path.join(dir, 'SHA256SUMS.txt'), 'x  y\n');
    await writeFile(path.join(dir, 'private.pem'), privatePem);
    await assert.rejects(signMain(['--sums', path.join(dir, 'SHA256SUMS.txt'), '--key-file', path.join(dir, 'private.pem')]), /keys\.ts/);
  });
});

test('Signieren: mit --trusted-pub entsteht .sig, das der Testschlüssel prüft', async () => {
  await temp(async (dir) => {
    const { privatePem, publicPem } = keypair();
    const sums = path.join(dir, 'SHA256SUMS.txt');
    await writeFile(sums, 'x  y\n');
    await writeFile(path.join(dir, 'private.pem'), privatePem);
    await writeFile(path.join(dir, 'public.pem'), publicPem);
    await signMain(['--sums', sums, '--key-file', path.join(dir, 'private.pem'), '--trusted-pub', path.join(dir, 'public.pem')]);
    const sig = Buffer.from((await readFile(`${sums}.sig`, 'utf8')).trim(), 'base64');
    assert.ok(verify(null, await readFile(sums), createPublicKey(publicPem), sig));
  });
});

test('Schlüssel: keys.ts enthält gültige Ed25519-Schlüssel, die ins Paket gehen', async () => {
  const keys = await readEmbeddedKeys(ROOT);
  assert.ok(keys.length >= 1);
  for (const key of keys) assert.equal(createPublicKey(key.publicKey).asymmetricKeyType, 'ed25519');
  assert.throws(() => parseEmbeddedKeys('export const x = 1;'), /kein öffentlicher Schlüssel/);
});

test('Paket: Updater und Schlüssel liegen unter tools/, die Testmarkierung nur auf Verlangen', async () => {
  await temp(async (dir) => {
    const logs = [];
    const options = parseArgs(['--target', 'linux-x64']);
    await writeUpdateFiles({ root: ROOT, outDir: path.join(dir, 'prod'), options, log: (line) => logs.push(line) });
    const prod = await readFile(path.join(dir, 'prod', 'tools', 'update-keys.json'), 'utf8');
    assert.equal(JSON.parse(prod).keys.length, (await readEmbeddedKeys(ROOT)).length);
    await assert.rejects(readFile(path.join(dir, 'prod', 'tools', 'update-test.json')), /ENOENT/);
    assert.ok((await readFile(path.join(dir, 'prod', 'tools', 'updater.mjs'), 'utf8')).includes('privilegierter Updater'));

    const { publicPem } = keypair();
    await writeFile(path.join(dir, 'test-key.pem'), publicPem);
    const testOptions = parseArgs(['--target', 'linux-x64', '--test-update-api', 'http://127.0.0.1:4599', '--test-update-key', path.join(dir, 'test-key.pem')]);
    await writeUpdateFiles({ root: ROOT, outDir: path.join(dir, 'ci'), options: testOptions, log: (line) => logs.push(line) });
    const marker = JSON.parse(await readFile(path.join(dir, 'ci', 'tools', 'update-test.json'), 'utf8'));
    assert.equal(marker.apiBase, 'http://127.0.0.1:4599');
    assert.equal(marker.trustedKeys[0].publicKey, publicPem);
    const ciKeys = JSON.parse(await readFile(path.join(dir, 'ci', 'tools', 'update-keys.json'), 'utf8')).keys;
    assert.ok(ciKeys.some((key) => key.id === 'ci-test'));
    assert.ok(logs.some((line) => line.includes('TEST-PAKET')));
  });
});

test('Paket: Optionen für Testversion und Testquelle', () => {
  assert.equal(parseArgs(['--target', 'linux-x64', '--version-override', '0.1.1']).versionOverride, '0.1.1');
  assert.throws(() => parseArgs(['--target', 'linux-x64', '--version-override', 'neu']), /Version wie 0\.1\.1/);
  assert.throws(() => parseArgs(['--target', 'linux-x64', '--test-update-api', 'http://127.0.0.1:1']), /gehören zusammen/);
});

test('Installer: Update-Dateien sind eingebunden, Einheiten ohne Bindung an die Anwendung', async () => {
  const read = async (...parts) => (await readFile(path.join(ROOT, 'installer', ...parts), 'utf8')).replace(/\r\n/g, '\n');
  const service = await read('linux', 'craftmanager-update.service');
  assert.match(service, /^Type=oneshot$/m);
  assert.ok(!/^(BindsTo|PartOf|Requires|Requisite|Wants)=.*craftmanager\.service/m.test(service), 'darf nicht an craftmanager.service hängen');
  assert.match(await read('linux', 'craftmanager-update.path'), /^PathExists=\/var\/lib\/craftmanager-update\/request\/request\.json$/m);
  const app = await read('linux', 'craftmanager.service');
  assert.match(app, /^Environment=UPDATE_DIR=\/var\/lib\/craftmanager-update$/m);
  assert.match(app, /^ReadWritePaths=\/var\/lib\/craftmanager \/var\/lib\/craftmanager-update\/request$/m);
  const install = await read('linux', 'install.sh');
  assert.match(install, /--upgrade/);
  assert.match(install, /install -d -o root -g root -m 0755 "\$UPDATE_ROOT"/);
  const xml = await read('windows', 'craftmanager-updater-service.xml');
  assert.ok(!/[^\x00-\x7f]/.test(xml), 'nur ASCII');
  assert.match(xml, /<id>craftmanager-updater<\/id>/);
  assert.match(xml, /updater\.mjs" watch/);
  assert.match(await read('windows', 'craftmanager-service.xml'), /UPDATE_DIR" value="@UPDATEROOT@"/);
  const iss = await read('windows', 'craftmanager.iss');
  assert.match(iss, /RegisterUpdater/);
  assert.match(iss, /PrepareUpdateFolders/);
  assert.ok(iss.includes("\work\" /inheritance:r"));
});
