#!/usr/bin/env node
// Erzeugt ein Ed25519-Schlüsselpaar für Release-Signaturen.
//   node scripts/update-keygen.mjs --out private.pem
// Der private Schlüssel (PKCS8-PEM) wird in die Datei geschrieben (nie überschrieben) und gehört als Secret
// UPDATE_SIGNING_KEY in die GitHub-Einstellungen, NICHT ins Repository. Der öffentliche Schlüssel wird ausgegeben und
// kommt in packages/backend/src/update/keys.ts.
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { out: { type: 'string' }, 'pub-out': { type: 'string' } }, strict: true });
if (values.out === undefined) {
  console.error('Verwendung: node scripts/update-keygen.mjs --out private.pem');
  process.exit(2);
}
if (existsSync(values.out)) {
  console.error(`Fehler: ${values.out} existiert bereits und wird nicht überschrieben.`);
  process.exit(1);
}
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
writeFileSync(values.out, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
if (values['pub-out'] !== undefined) writeFileSync(values['pub-out'], publicKey.export({ type: 'spki', format: 'pem' }));
console.log(`Privater Schlüssel: ${values.out} (geheim halten, als Secret UPDATE_SIGNING_KEY hinterlegen)`);
console.log('Öffentlicher Schlüssel (in keys.ts eintragen):\n');
console.log(publicKey.export({ type: 'spki', format: 'pem' }));
