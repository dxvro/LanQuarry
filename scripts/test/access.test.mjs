// Zugriff im Heimnetz, Hinweis "kein offizielles Minecraft-Produkt" und Passwort-Rücksetzung in den Installationspaketen
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DISCLAIMER, formatCredentials } from '../lib/config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = async (...parts) => (await readFile(path.join(ROOT, ...parts), 'utf8')).replace(/\r\n/g, '\n');

test('Hinweis: der Text steht überall, wo Menschen ihn sehen', async () => {
  assert.equal(DISCLAIMER, 'Kein offizielles Minecraft-Produkt. Nicht von Mojang oder Microsoft genehmigt oder mit ihnen verbunden.');
  const places = [
    ['README.md'],
    ['installer', 'windows', 'craftmanager.iss'],
    ['installer', 'windows', 'LIESMICH.txt'],
    ['installer', 'windows', 'start-portable.cmd'],
    ['installer', 'linux', 'LIESMICH.txt'],
    ['installer', 'linux', 'install.sh'],
    ['.github', 'workflows', 'release.yml'],
    ['packages', 'frontend', 'src', 'components', 'Disclaimer.tsx'],
  ];
  for (const parts of places) assert.ok((await read(...parts)).includes(DISCLAIMER), parts.join('/'));
  const readme = await read('README.md');
  assert.ok(readme.includes('NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.'));
  assert.ok((await read('.github', 'workflows', 'release.yml')).includes('NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.'));
  // Willkommens- und Abschlussseite des Installers
  const iss = await read('installer', 'windows', 'craftmanager.iss');
  assert.match(iss, /^german\.WelcomeLabel2=.*Kein offizielles Minecraft-Produkt/m);
  assert.match(iss, /^german\.FinishedLabel=.*Kein offizielles Minecraft-Produkt/m);
});

test('Zugangsdaten: Heimnetz-Adressen, Passwort-Hinweis und der Hinweis zu Minecraft', () => {
  const text = formatCredentials({
    url: 'http://pc:3000',
    token: 'GEHEIM',
    configFile: 'C:\\c.env',
    dataDir: 'C:\\d',
    lanText: '   http://192.168.178.20:3000\r\n   http://pc:3000   (Rechnername)',
  });
  for (const part of ['Adressen im Heimnetz', 'http://192.168.178.20:3000', 'zugleich das erste Passwort', DISCLAIMER]) assert.ok(text.includes(part), part);
});

test('Neustart: Exit-Code 75 in Anwendung, systemd-Einheit und portablem Start', async () => {
  assert.match(await read('packages', 'backend', 'src', 'system', 'restart.ts'), /RESTART_EXIT_CODE = 75;/);
  const unit = await read('installer', 'linux', 'craftmanager.service');
  assert.match(unit, /^Restart=on-failure$/m);
  assert.match(unit, /^RestartForceExitStatus=75$/m);
  assert.match(await read('installer', 'windows', 'start-portable.cmd'), /%errorlevel%==75/);
  assert.match(await read('installer', 'windows', 'craftmanager-service.xml'), /<onfailure action="restart"/);
});

test('Passwort zurücksetzen: Linux-Befehl und Windows-Startmenü', async () => {
  const wrapper = await read('installer', 'linux', 'craftmanager');
  assert.match(wrapper, /^#!\/bin\/sh/);
  assert.match(wrapper, /runuser -u "\$SERVICE_USER"/);
  assert.match(wrapper, /dist\/cli\.js/);
  assert.match(wrapper, /id -u/);
  const check = spawnSync('sh', ['-n', path.join(ROOT, 'installer', 'linux', 'craftmanager')], { encoding: 'utf8' });
  if (check.error === undefined) assert.equal(check.status, 0, check.stderr);
  const install = await read('installer', 'linux', 'install.sh');
  assert.match(install, /CLI_LINK=\/usr\/local\/bin\/craftmanager/);
  assert.match(install, /tools\/lan\.mjs/);
  assert.match(await read('installer', 'linux', 'uninstall.sh'), /rm -f \/usr\/local\/bin\/craftmanager/);

  const cmdRaw = await readFile(path.join(ROOT, 'installer', 'windows', 'reset-password.cmd'), 'utf8');
  assert.ok(!/[^\r]\n/.test(cmdRaw), 'Batch-Datei mit CRLF');
  assert.match(cmdRaw, /cli\.js" reset-password/);
  assert.match(cmdRaw, /-Verb RunAs/);
  assert.ok(!/[^\x00-\x7f]/.test(cmdRaw), 'nur ASCII');
  const iss = await read('installer', 'windows', 'craftmanager.iss');
  assert.match(iss, /Name: "\{group\}\\Passwort zurücksetzen"; Filename: "\{app\}\\reset-password\.cmd"/);
  assert.match(iss, /function LanAddressText/);
  const packager = await read('scripts', 'package.mjs');
  assert.match(packager, /lan\.mjs/);
  assert.match(packager, /reset-password\.cmd/);
  assert.match(packager, /'craftmanager', 'craftmanager\.service'/);
});
