import assert from 'node:assert/strict';
import { test } from 'node:test';
import { foreignLibsqlPackages, getTarget, hostTargetName, nodeArchiveName, parseArgs, releaseBaseName, TARGET_NAMES } from '../lib/targets.mjs';

test('Zielsystem: alle drei Ziele sind definiert', () => {
  assert.deepEqual(TARGET_NAMES, ['win-x64', 'linux-x64', 'linux-arm64']);
  assert.equal(getTarget('win-x64').nodeBinaryName, 'node.exe');
  assert.equal(getTarget('linux-arm64').libsql, '@libsql/linux-arm64-gnu');
  assert.equal(getTarget('linux-x64').archiveKind, 'tar.gz');
  assert.equal(getTarget('win-x64').archiveKind, 'zip');
});

test('Zielsystem: unbekanntes Ziel wird mit deutscher Meldung abgelehnt', () => {
  assert.throws(() => getTarget('macos-arm64'), /Unbekanntes Ziel/);
});

test('Zielsystem: Build-Rechner wird erkannt', () => {
  assert.equal(hostTargetName('win32', 'x64'), 'win-x64');
  assert.equal(hostTargetName('linux', 'arm64'), 'linux-arm64');
  assert.equal(hostTargetName('darwin', 'arm64'), null);
});

test('Dateinamen: Node-Archiv und Paketname', () => {
  assert.equal(nodeArchiveName('v26.13.0', getTarget('win-x64')), 'node-v26.13.0-win-x64.zip');
  assert.equal(nodeArchiveName('v26.13.0', getTarget('linux-arm64')), 'node-v26.13.0-linux-arm64.tar.gz');
  assert.equal(releaseBaseName('0.1.0', getTarget('linux-x64')), 'craftmanager-0.1.0-linux-x64');
});

test('libsql: fremde Plattformpakete werden erkannt, das eigene bleibt', () => {
  const installed = ['@libsql/client', '@libsql/core', '@libsql/linux-x64-gnu', '@libsql/linux-x64-musl', '@libsql/win32-x64-msvc', '@libsql/darwin-arm64'];
  assert.deepEqual(foreignLibsqlPackages(installed, getTarget('linux-x64')), ['@libsql/linux-x64-musl', '@libsql/win32-x64-msvc', '@libsql/darwin-arm64']);
  assert.deepEqual(foreignLibsqlPackages(installed, getTarget('win-x64')), ['@libsql/linux-x64-gnu', '@libsql/linux-x64-musl', '@libsql/darwin-arm64']);
});

test('Argumente: gültige Aufrufe', () => {
  assert.equal(parseArgs(['--target', 'win-x64']).target, 'win-x64');
  assert.equal(parseArgs(['--target=linux-x64', '--skip-build', '--no-archive']).skipBuild, true);
  assert.equal(parseArgs(['--target', 'linux-x64', '--node-version', 'v24.1.0']).nodeVersion, 'v24.1.0');
  assert.equal(parseArgs(['--help']).help, true);
});

test('Argumente: Fehler', () => {
  assert.throws(() => parseArgs([]), /--target angeben/);
  assert.throws(() => parseArgs(['--target']), /fehlt ein Wert/);
  assert.throws(() => parseArgs(['--target', 'bsd-x64']), /Unbekanntes Ziel/);
  assert.throws(() => parseArgs(['--target', 'win-x64', '--bogus']), /Unbekannte Option/);
  assert.throws(() => parseArgs(['--target', 'win-x64', '--node-version', '26']), /v22\.11\.0/);
});
