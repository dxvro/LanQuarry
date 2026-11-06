// Die Adresslogik der Installer (installer/common/lan.mjs) muss dasselbe ergeben wie die der Anwendung
// (packages/backend/src/lib/network.ts, Test: packages/backend/test/network.test.ts): beide lesen scripts/test/lan-cases.json.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { detectAddresses, formatText, isVirtualInterface, resolvePort } from '../../installer/common/lan.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LAN = path.join(HERE, '..', '..', 'installer', 'common', 'lan.mjs');
const cases = JSON.parse(await readFile(path.join(HERE, 'lan-cases.json'), 'utf8'));

let dir;
before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'cm-lan-'));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

for (const testCase of cases) {
  test(`Adressen: ${testCase.name}`, () => {
    const found = detectAddresses(testCase.interfaces);
    assert.deepEqual(
      found.lan.map((entry) => [entry.address, entry.interfaceName, entry.private]),
      testCase.lan,
    );
    assert.deepEqual(
      found.virtual.map((entry) => [entry.address, entry.interfaceName, entry.private]),
      testCase.virtual,
    );
  });
}

test('Adapternamen: virtuelle werden erkannt, gewöhnliche nicht', () => {
  for (const name of ['vEthernet (WSL)', 'docker0', 'br-abc', 'virbr0', 'VMware Network Adapter VMnet1', 'Tailscale', 'ZeroTier One', 'wg0', 'tun0', 'utun3']) {
    assert.equal(isVirtualInterface(name), true, name);
  }
  for (const name of ['Ethernet', 'Ethernet 2', 'WLAN', 'eth0', 'enp3s0', 'wlan0', 'en0']) assert.equal(isVirtualInterface(name), false, name);
});

test('Text: LAN-Adressen, Rechnername und getrennt die virtuellen Adapter, nur ASCII', () => {
  const text = formatText(detectAddresses(cases[0].interfaces), 3000, 'MCPC');
  assert.match(text, /http:\/\/192\.168\.178\.20:3000/);
  assert.match(text, /http:\/\/MCPC:3000 {3}\(Rechnername\)/);
  assert.match(text, /VPN\/virtuelle Adapter/);
  assert.match(text, /http:\/\/172\.28\.16\.1:3000 {3}\[vEthernet/);
  assert.match(formatText({ lan: [], virtual: [] }, 3000, 'PC'), /keine Netzwerkadresse/);
  assert.doesNotMatch(formatText({ lan: [], virtual: [{ address: '10.0.0.1', interfaceName: 'Ethernet für Gäste', private: true }] }, 1, 'PC'), /[^\x00-\x7f]/);
});

test('Port: --port vor network.json vor Konfiguration vor 3000', async () => {
  const data = path.join(dir, 'data');
  await mkdir(data, { recursive: true });
  const config = path.join(dir, 'craftmanager.env');
  assert.equal(resolvePort({}), 3000);
  await writeFile(config, "PORT='4000'\n");
  assert.equal(resolvePort({ config }), 4000);
  await writeFile(path.join(data, 'network.json'), JSON.stringify({ host: '0.0.0.0', port: 4100 }));
  assert.equal(resolvePort({ config, dataDir: data }), 4100);
  assert.equal(resolvePort({ config, dataDir: data, port: '4200' }), 4200);
  await writeFile(path.join(data, 'network.json'), 'kaputt');
  assert.equal(resolvePort({ config, dataDir: data }), 4000);
});

test('Kommandozeile: --json, --text und --probe laufen mit dem Port der Anwendung', async () => {
  const data = path.join(dir, 'data');
  await mkdir(data, { recursive: true });
  const config = path.join(dir, 'cli.env');
  await writeFile(config, `PORT='3000'\nDATA_DIR='${data}'\n`);
  await writeFile(path.join(data, 'network.json'), JSON.stringify({ host: '0.0.0.0', port: 4300, probeHost: '127.0.0.1' }));
  const run = (...args) => spawnSync(process.execPath, [LAN, '--data-dir', data, '--config', config, ...args], { encoding: 'utf8' });
  const json = run('--json');
  assert.equal(json.status, 0, json.stderr);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.port, 4300);
  assert.ok(Array.isArray(parsed.lan) && Array.isArray(parsed.virtual));
  assert.ok(parsed.lan.every((entry) => entry.url === `http://${entry.address}:4300`));
  const text = run('--text');
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /:4300/);
  const probe = run('--probe');
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(probe.stdout.trim(), 'http://127.0.0.1:4300');
});
