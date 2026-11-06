#!/usr/bin/env node
// Signiert SHA256SUMS.txt mit Ed25519 (Node crypto) und prüft das Ergebnis sofort.
//
//   UPDATE_SIGNING_KEY="$(cat private.pem)" node scripts/sign-release.mjs --sums dist/SHA256SUMS.txt
//   node scripts/sign-release.mjs --sums SHA256SUMS.txt --key-file private.pem --out SHA256SUMS.txt.sig
//
// Der private Schlüssel (PKCS8-PEM) kommt aus der Umgebungsvariable UPDATE_SIGNING_KEY (GitHub-Actions-Secret) oder
// aus --key-file. Ohne Schlüssel bricht das Skript ab, damit nie ein Release ohne Signatur entsteht. Der zugehörige
// öffentliche Schlüssel muss in packages/backend/src/update/keys.ts stehen, sonst könnte kein Client das Release
// annehmen (--trusted-pub ersetzt diese Prüfung durch einen anderen Schlüssel, z. B. im CI-Test).
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readEmbeddedKeys } from './lib/update-files.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Secrets verlieren beim Einfügen manchmal die Zeilenumbrüche; die PEM-Struktur wird wiederhergestellt
export function normalizePem(text) {
  const match = /-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/.exec(text.trim());
  if (match === null) throw new Error('Der Schlüssel ist kein PEM (-----BEGIN PRIVATE KEY-----).');
  const body = match[2].replace(/\s+/g, '');
  return `-----BEGIN ${match[1]}-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END ${match[1]}-----\n`;
}

export function signSums(sums, privatePem) {
  const privateKey = createPrivateKey(normalizePem(privatePem));
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Der Signaturschlüssel muss ein Ed25519-Schlüssel sein.');
  const signature = sign(null, sums, privateKey);
  const publicKey = createPublicKey(privateKey);
  if (!verify(null, sums, publicKey, signature)) throw new Error('Die erzeugte Signatur ließ sich nicht prüfen.');
  return { signature, publicPem: publicKey.export({ type: 'spki', format: 'pem' }) };
}

const spkiOf = (pem) => createPublicKey(pem).export({ type: 'spki', format: 'der' }).toString('base64');

export async function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { sums: { type: 'string' }, out: { type: 'string' }, 'key-file': { type: 'string' }, 'trusted-pub': { type: 'string' } },
    strict: true,
  });
  if (values.sums === undefined) throw new Error('--sums <Datei> fehlt.');
  const privatePem = values['key-file'] === undefined ? process.env.UPDATE_SIGNING_KEY : await readFile(values['key-file'], 'utf8');
  if (privatePem === undefined || privatePem.trim() === '') {
    throw new Error('Kein Signaturschlüssel: Das Secret UPDATE_SIGNING_KEY ist nicht gesetzt (oder --key-file fehlt). Ohne Signatur wird kein Release veröffentlicht.');
  }
  const sums = await readFile(values.sums);
  if (sums.length === 0) throw new Error('SHA256SUMS.txt ist leer.');
  const { signature, publicPem } = signSums(sums, privatePem);
  const trusted = values['trusted-pub'] === undefined ? (await readEmbeddedKeys(ROOT)).map((key) => key.publicKey) : [await readFile(values['trusted-pub'], 'utf8')];
  if (!trusted.some((pem) => spkiOf(pem) === spkiOf(publicPem))) {
    throw new Error('Der Signaturschlüssel gehört zu keinem öffentlichen Schlüssel in packages/backend/src/update/keys.ts. Clients würden das Release ablehnen.');
  }
  const out = values.out ?? `${values.sums}.sig`;
  await writeFile(out, `${signature.toString('base64')}\n`);
  console.log(`Signatur geschrieben: ${out}`);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Fehler: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
