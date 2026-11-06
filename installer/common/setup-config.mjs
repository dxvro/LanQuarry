// Legt bei der Erstinstallation die Konfigurationsdatei an (mit zufälligem AUTH_TOKEN).
// Existiert die Datei schon, passiert nichts: Konfiguration und Token bleiben bei Updates erhalten.
//
//   node setup-config.mjs --config <Datei> --data-dir <Ordner> --servers-dir <Ordner>
//        [--port 3000] [--host 0.0.0.0] [--hostname <Name>] [--credentials-file <Datei>] [--print-token]
//
// Ausgabe (stdout, eine Zeile JSON): {"created":true|false,"url":"http://<Name>:<Port>"[,"token":"..."]}
// Das Token erscheint nur mit --print-token (für install.sh), nie im Protokoll des Installers.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { configValues, formatCredentials, generateToken, parsePort, renderTemplate, webUrl } from './config.mjs';
import { detectAddresses, formatText } from './lan.mjs';

const { values } = parseArgs({
  options: {
    config: { type: 'string' },
    'data-dir': { type: 'string' },
    'servers-dir': { type: 'string' },
    port: { type: 'string', default: '3000' },
    host: { type: 'string', default: '0.0.0.0' },
    hostname: { type: 'string' },
    'credentials-file': { type: 'string' },
    'print-token': { type: 'boolean', default: false },
  },
  strict: true,
});

function fail(message) {
  console.error(`Fehler: ${message}`);
  process.exit(1);
}

const configFile = values.config;
if (configFile === undefined) fail('--config fehlt.');
const dataDir = values['data-dir'] ?? 'data';
const serversDir = values['servers-dir'] ?? 'servers';
const port = parsePort(values.port);
const hostname = values.hostname ?? os.hostname();
const url = webUrl(hostname, port);

if (existsSync(configFile)) {
  console.log(JSON.stringify({ created: false, url }));
  process.exit(0);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const template = readFileSync(path.join(here, 'craftmanager.env.template'), 'utf8');
const token = generateToken();
const content = renderTemplate(template, configValues({ token, dataDir, serversDir, port, host: values.host }));

mkdirSync(path.dirname(configFile), { recursive: true });
// 'wx': nie eine vorhandene Datei überschreiben, auch nicht bei gleichzeitigem Aufruf
writeFileSync(configFile, content, { encoding: 'utf8', mode: 0o640, flag: 'wx' });
if (process.platform !== 'win32') chmodSync(configFile, 0o640);

if (values['credentials-file'] !== undefined) {
  const credentials = formatCredentials({
    url,
    localUrl: webUrl('localhost', port),
    lanText: formatText(detectAddresses(), port, hostname),
    token,
    configFile,
    dataDir: path.resolve(dataDir),
    serversDir: path.resolve(serversDir),
  });
  mkdirSync(path.dirname(values['credentials-file']), { recursive: true });
  // UTF-8 mit BOM, damit auch ältere Editoren die Umlaute richtig anzeigen
  writeFileSync(values['credentials-file'], `﻿${credentials}`, { encoding: 'utf8', mode: 0o600 });
}

console.log(JSON.stringify({ created: true, url, ...(values['print-token'] ? { token } : {}) }));
