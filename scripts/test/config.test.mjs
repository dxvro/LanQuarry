import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { after, before, test } from 'node:test';
import { configValues, formatCredentials, generateToken, parsePort, quoteEnvValue, renderTemplate } from '../lib/config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEMPLATE = path.join(ROOT, 'installer', 'common', 'craftmanager.env.template');

let dir;
before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'cm-config-'));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('Token: 32 URL-sichere Zeichen, jedes Mal anders', () => {
  const a = generateToken();
  const b = generateToken();
  assert.match(a, /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(a, b);
});

test('Werte: einfache Anführungszeichen, keine Zeilenumbrüche', () => {
  assert.equal(quoteEnvValue('C:\\ProgramData\\LocalMC CraftManager\\data'), "'C:\\ProgramData\\LocalMC CraftManager\\data'");
  assert.throws(() => quoteEnvValue("a'b"), /Ungültiger Konfigurationswert/);
  assert.throws(() => quoteEnvValue('a\nb'), /Ungültiger Konfigurationswert/);
});

test('Port: Grenzen', () => {
  assert.equal(parsePort('3000'), 3000);
  assert.throws(() => parsePort('0'), /Ungültiger Port/);
  assert.throws(() => parsePort('70000'), /Ungültiger Port/);
  assert.throws(() => parsePort('abc'), /Ungültiger Port/);
});

test('Vorlage: Platzhalter werden ersetzt, fehlende Werte sind ein Fehler', () => {
  assert.equal(renderTemplate('a=@X@ b=@Y@', { X: '1', Y: '2' }), 'a=1 b=2');
  assert.throws(() => renderTemplate('a=@FEHLT@', {}), /@FEHLT@/);
});

test('Vorlage: gerenderte Datei lässt sich von Node (und damit vom Backend) einlesen, Windows-Pfade bleiben heil', async () => {
  const template = (await readFile(TEMPLATE, 'utf8')).replace(/\r\n/g, '\n');
  const values = configValues({
    token: 'tok-ABCdef_123456789',
    dataDir: 'C:\\ProgramData\\LocalMC CraftManager\\data',
    serversDir: 'C:\\ProgramData\\LocalMC CraftManager\\servers',
    port: 3000,
    host: '0.0.0.0',
  });
  const parsed = parseEnv(renderTemplate(template, values));
  assert.equal(parsed.AUTH_TOKEN, 'tok-ABCdef_123456789');
  assert.equal(parsed.DATA_DIR, 'C:\\ProgramData\\LocalMC CraftManager\\data');
  assert.equal(parsed.SERVERS_DIR, 'C:\\ProgramData\\LocalMC CraftManager\\servers');
  assert.equal(parsed.PORT, '3000');
  assert.equal(parsed.HOST, '0.0.0.0');
  assert.equal(parsed.STOP_TIMEOUT_SECONDS, '120');
  assert.equal(parsed.ALLOWED_HOSTS, undefined, 'auskommentierte Einträge zählen nicht');
});

test('Zugangsdaten: enthalten Adresse, Token und Pfade', () => {
  const text = formatCredentials({ url: 'http://pc:3000', localUrl: 'http://localhost:3000', token: 'GEHEIM', configFile: 'C:\\c.env', dataDir: 'C:\\d', serversDir: 'C:\\s' });
  for (const part of ['http://pc:3000', 'http://localhost:3000', 'GEHEIM', 'C:\\c.env', 'C:\\d', 'C:\\s']) assert.ok(text.includes(part), part);
});

test('setup-config: legt Konfiguration einmalig an und überschreibt nie', async () => {
  const tools = path.join(dir, 'tools');
  await cp(path.join(ROOT, 'installer', 'common', 'setup-config.mjs'), path.join(tools, 'setup-config.mjs'));
  await cp(path.join(ROOT, 'scripts', 'lib', 'config.mjs'), path.join(tools, 'config.mjs'));
  await cp(path.join(ROOT, 'installer', 'common', 'lan.mjs'), path.join(tools, 'lan.mjs'));
  await cp(TEMPLATE, path.join(tools, 'craftmanager.env.template'));
  const config = path.join(dir, 'etc', 'craftmanager.env');
  const credentials = path.join(dir, 'Zugangsdaten.txt');
  const run = (...extra) =>
    spawnSync(
      process.execPath,
      [path.join(tools, 'setup-config.mjs'), '--config', config, '--data-dir', path.join(dir, 'data'), '--servers-dir', path.join(dir, 'servers'), '--port', '4567', '--hostname', 'testpc', ...extra],
      { encoding: 'utf8' },
    );

  const first = run('--credentials-file', credentials);
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(JSON.parse(first.stdout), { created: true, url: 'http://testpc:4567' }, 'ohne --print-token erscheint das Token nicht in der Ausgabe');
  const env = parseEnv(await readFile(config, 'utf8'));
  assert.match(env.AUTH_TOKEN, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(env.PORT, '4567');
  assert.equal(env.DATA_DIR, path.join(dir, 'data'));
  const credText = await readFile(credentials, 'utf8');
  assert.ok(credText.includes(env.AUTH_TOKEN));
  assert.ok(credText.startsWith('\ufeff'), 'UTF-8-BOM');
  if (process.platform !== 'win32') assert.equal((await stat(config)).mode & 0o777, 0o640);

  const second = run('--print-token');
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(JSON.parse(second.stdout), { created: false, url: 'http://testpc:4567' });
  assert.equal(parseEnv(await readFile(config, 'utf8')).AUTH_TOKEN, env.AUTH_TOKEN, 'Token bleibt beim zweiten Aufruf erhalten');

  await rm(config);
  const third = run('--print-token');
  assert.equal(JSON.parse(third.stdout).token.length, 32);
});

test('setup-config: ungültiger Port ergibt einen Fehler', () => {
  const result = spawnSync(process.execPath, [path.join(dir, 'tools', 'setup-config.mjs'), '--config', path.join(dir, 'x.env'), '--port', '99999'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
});
