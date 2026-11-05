import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { lookupShasum, parseShasums, sha256Buffer, verifyIntegrity } from '../lib/checksums.mjs';

const A = 'a'.repeat(64);
const B = 'B'.repeat(64);

test('SHASUMS256.txt wird zeilenweise gelesen', () => {
  const map = parseShasums(`${A}  node-v26.13.0-win-x64.zip\n${B}  win-x64/node.exe\r\n\n`);
  assert.equal(map.size, 2);
  assert.equal(lookupShasum(map, 'node-v26.13.0-win-x64.zip'), A);
  assert.equal(lookupShasum(map, 'win-x64/node.exe'), 'b'.repeat(64));
});

test('SHASUMS256.txt: Binärmarkierung * wird akzeptiert, kaputte Zeilen nicht', () => {
  assert.equal(parseShasums(`${A} *datei.tar.gz`).get('datei.tar.gz'), A);
  assert.throws(() => parseShasums('keine Prüfsumme hier'), /Ungueltige Zeile/);
  assert.throws(() => parseShasums(`${A.slice(1)}  zu-kurz`), /Ungueltige Zeile/);
});

test('Prüfsumme fehlt: deutsche Fehlermeldung', () => {
  assert.throws(() => lookupShasum(new Map(), 'x.zip'), /Keine Pruefsumme fuer x\.zip/);
});

test('SHA-256 eines Puffers', () => {
  assert.equal(sha256Buffer(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('npm-Integrität: richtig, falsch, mehrere Einträge', () => {
  const data = Buffer.from('paket');
  const good = `sha512-${createHash('sha512').update(data).digest('base64')}`;
  assert.equal(verifyIntegrity(data, good), true);
  assert.equal(verifyIntegrity(Buffer.from('anders'), good), false);
  assert.equal(verifyIntegrity(data, `sha1-xxx ${good}`), true);
  assert.equal(verifyIntegrity(data, 'unbekannt'), false);
});
