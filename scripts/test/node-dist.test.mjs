import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nodeArchiveEntries, nodeDistUrl, selectLts } from '../lib/node-dist.mjs';
import { getTarget } from '../lib/targets.mjs';

const INDEX = [
  { version: 'v27.0.0-alpha.1', lts: false },
  { version: 'v26.13.0', lts: 'Lithium' },
  { version: 'v26.12.1', lts: false },
  { version: 'v24.20.1', lts: 'Krypton' },
  { version: 'v24.9.0', lts: 'Krypton' },
];

test('LTS: neueste Version mit LTS-Name', () => {
  assert.equal(selectLts(INDEX), 'v26.13.0');
  assert.equal(selectLts([...INDEX].reverse()), 'v26.13.0');
});

test('LTS: Versionsvergleich ist numerisch, nicht textuell', () => {
  assert.equal(selectLts([{ version: 'v22.9.0', lts: 'Jod' }, { version: 'v22.10.0', lts: 'Jod' }]), 'v22.10.0');
});

test('LTS: Fehler bei leerem oder falschem Index', () => {
  assert.throws(() => selectLts([{ version: 'v27.0.0', lts: false }]), /Keine LTS-Version/);
  assert.throws(() => selectLts({}), /Unerwartetes Format/);
});

test('Adressen und Archivpfade', () => {
  assert.equal(nodeDistUrl('v26.13.0', 'SHASUMS256.txt'), 'https://nodejs.org/dist/v26.13.0/SHASUMS256.txt');
  assert.deepEqual(nodeArchiveEntries('v26.13.0', getTarget('win-x64')), {
    binary: 'node-v26.13.0-win-x64/node.exe',
    license: 'node-v26.13.0-win-x64/LICENSE',
  });
  assert.equal(nodeArchiveEntries('v26.13.0', getTarget('linux-arm64')).binary, 'node-v26.13.0-linux-arm64/bin/node');
});
