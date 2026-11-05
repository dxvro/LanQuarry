import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { describeSpawnFailure } from '../lib/probe.mjs';

test('Fehlertext: Startfehler ohne stdout/stderr zeigt Meldung und Code, nie "undefined"', () => {
  const error = Object.assign(new Error('spawn /x/node EACCES'), { code: 'EACCES' });
  const text = describeSpawnFailure({ error, status: null, signal: null });
  assert.match(text, /spawn \/x\/node EACCES \(EACCES\)/);
  assert.doesNotMatch(text, /undefined|null/);
});

test('Fehlertext: Exit-Status mit stdout und stderr', () => {
  const text = describeSpawnFailure({ status: 3, stdout: 'ausgabe\n', stderr: 'fehler\n' });
  assert.match(text, /Exit-Status 3/);
  assert.match(text, /stdout:\nausgabe/);
  assert.match(text, /stderr:\nfehler/);
});

test('Fehlertext: leere Ausgaben und Signal', () => {
  assert.match(describeSpawnFailure({ status: null, signal: 'SIGKILL', stdout: '', stderr: null }), /Signal SIGKILL/);
  assert.doesNotMatch(describeSpawnFailure({ status: 1, stdout: '', stderr: '' }), /stdout|stderr/);
  assert.match(describeSpawnFailure({}), /unbekannter Fehler/);
});

test('Fehlertext: echter spawnSync-Fehler (nicht vorhandene Datei)', () => {
  const result = spawnSync('/gibt/es/nicht-cm-probe', [], { encoding: 'utf8' });
  assert.match(describeSpawnFailure(result), /ENOENT/);
});
