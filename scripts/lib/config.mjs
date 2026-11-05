// Erzeugt die Konfigurationsdatei und die Zugangsdaten bei der Erstinstallation.
// Wird vom Paket mitgeliefert (tools/config.mjs) und von setup-config.mjs, install.sh und dem
// Windows-Installer benutzt; deshalb nur Node-Bordmittel und reine Funktionen.
import { randomBytes } from 'node:crypto';

// 24 zufällige Bytes ergeben 32 Zeichen aus A-Z a-z 0-9 - _ (192 Bit)
export function generateToken(bytes = 24) {
  return randomBytes(bytes).toString('base64url');
}

// Werte fuer Dateien im .env-Format: einfache Anfuehrungszeichen, denn Node (util.parseEnv)
// wertet darin keine Escape-Folgen aus, Backslashes unter Windows bleiben also erhalten.
export function quoteEnvValue(value) {
  if (/[\r\n']/.test(value)) throw new Error(`Ungültiger Konfigurationswert: ${JSON.stringify(value)}`);
  return `'${value}'`;
}

// Platzhalter @NAME@ im Vorlagentext ersetzen; unbekannte Platzhalter sind ein Fehler
export function renderTemplate(template, values) {
  return template.replace(/@([A-Z_]+)@/g, (_match, key) => {
    if (!(key in values)) throw new Error(`Platzhalter @${key}@ hat keinen Wert.`);
    return values[key];
  });
}

export function configValues({ token, dataDir, serversDir, port, host }) {
  return {
    HOST: host,
    PORT: String(port),
    AUTH_TOKEN: quoteEnvValue(token),
    DATA_DIR: quoteEnvValue(dataDir),
    SERVERS_DIR: quoteEnvValue(serversDir),
  };
}

export function parsePort(text) {
  const port = Number(text);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Ungültiger Port: ${text}`);
  return port;
}

export function webUrl(hostname, port) {
  return `http://${hostname}:${port}`;
}

export function formatCredentials({ url, token, configFile, dataDir, serversDir, localUrl, notice }) {
  const lines = [
    'LocalMC CraftManager - Zugangsdaten',
    '===================================',
    '',
    `Adresse:       ${url}`,
    ...(localUrl === undefined ? [] : [`Auf diesem PC:  ${localUrl}`]),
    `Zugriffstoken: ${token}`,
    '',
    'Mit diesem Token meldest du dich in der Weboberfläche an.',
    `Das Token steht auch in der Konfigurationsdatei:`,
    `  ${configFile}`,
    `Daten (Datenbank, Backups, Java) liegen unter:`,
    `  ${dataDir}`,
    ...(serversDir === undefined ? [] : [`Minecraft-Server liegen unter:`, `  ${serversDir}`]),
    '',
    ...(notice === undefined ? [] : [notice, '']),
    'Diese Datei enthält ein Geheimnis. Sie ist nur für Administratoren lesbar.',
    'Nach dem Notieren des Tokens kann sie gelöscht werden.',
    '',
  ];
  return lines.join('\r\n');
}
