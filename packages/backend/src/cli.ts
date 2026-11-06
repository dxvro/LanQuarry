import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePassword, hashPassword, validateNewPassword } from './auth/password.js';
import { PasswordStore } from './auth/store.js';
import { ConfigError, loadConfig, loadDotEnv } from './config/env.js';
import { openDb } from './db/client.js';

// Local administration of an installed CraftManager. It works on the database file directly, so it needs the same
// rights as the application itself (root / the service account / an administrator) and never opens a network port:
// a forgotten password can only be reset by someone who controls the machine.
//
//   node cli.js reset-password [--password-stdin]

export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
  // the first line of standard input (for --password-stdin)
  readStdin: () => Promise<string>;
  env?: NodeJS.ProcessEnv;
}

const USAGE = `LocalMC CraftManager - Verwaltung auf dem Server-Rechner

  craftmanager reset-password [--password-stdin]

    Setzt das Passwort der Weboberfläche zurück und meldet alle bestehenden Sitzungen ab.
    Ohne Option wird ein zufälliges neues Passwort erzeugt und angezeigt.
    --password-stdin   liest das neue Passwort aus der Standardeingabe (erste Zeile, mindestens 10 Zeichen)

    Das Zugriffstoken (AUTH_TOKEN) der Konfigurationsdatei bleibt unverändert; es gilt für Skripte weiter.
`;

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString('utf8');
}

async function resetPassword(args: string[], io: CliIo): Promise<number> {
  const unknown = args.filter((arg) => arg !== '--password-stdin' && arg !== '--stdin');
  if (unknown.length > 0) {
    io.err(`Unbekannte Option: ${unknown[0]}\n\n${USAGE}`);
    return 2;
  }
  const fromStdin = args.length > 0;

  let password: string;
  if (fromStdin) {
    password = ((await io.readStdin()).split(/\r?\n/)[0] ?? '').replace(/\r$/, '');
    const problem = validateNewPassword(password);
    if (problem !== null) {
      io.err(`Fehler: ${problem}`);
      return 1;
    }
  } else {
    password = generatePassword();
  }

  const env = io.env ?? process.env;
  let dataDir: string;
  try {
    loadDotEnv(env);
    dataDir = loadConfig(env).dataDir;
  } catch (error) {
    io.err(error instanceof ConfigError ? error.message : `Fehler: Die Konfiguration konnte nicht gelesen werden (${error instanceof Error ? error.message : String(error)}).`);
    return 1;
  }
  const dbFile = path.join(dataDir, 'craftmanager.db');
  if (!existsSync(dbFile)) {
    io.err(`Fehler: Die Datenbank ${dbFile} existiert nicht. Wurde CraftManager schon gestartet, und zeigt CONFIG_FILE auf die richtige Konfiguration?`);
    return 1;
  }

  const handle = await openDb(dbFile);
  try {
    const store = new PasswordStore(handle.db);
    try {
      await store.load();
    } catch {
      io.err('Fehler: Die Datenbank ist noch nicht eingerichtet. Bitte CraftManager einmal starten und danach den Befehl wiederholen.');
      return 1;
    }
    await store.save(await hashPassword(password));
  } catch (error) {
    io.err(`Fehler: Das Passwort konnte nicht gespeichert werden (${error instanceof Error ? error.message : String(error)}). Fehlen die Rechte auf ${dataDir}? Als Administrator bzw. root ausführen.`);
    return 1;
  } finally {
    handle.close();
  }

  io.out('Das Passwort der Weboberfläche wurde zurückgesetzt. Alle bestehenden Anmeldungen sind beendet.');
  if (!fromStdin) {
    io.out('');
    io.out(`  Neues Passwort: ${password}`);
    io.out('');
    io.out('Bitte nach der Anmeldung unter System > Passwort ein eigenes Passwort festlegen.');
  }
  io.out('Das Zugriffstoken (AUTH_TOKEN) für Skripte und die API ist unverändert.');
  return 0;
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'reset-password':
      return resetPassword(rest, io);
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      io.out(USAGE);
      return 0;
    default:
      io.err(`Unbekannter Befehl: ${command}\n\n${USAGE}`);
      return 2;
  }
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runCli(process.argv.slice(2), {
    out: (text) => console.log(text),
    err: (text) => console.error(text),
    readStdin: readAllStdin,
  }).then(
    (code) => {
      // no process.exit: let the output drain first
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error('Fehler:', error);
      process.exitCode = 1;
    },
  );
}
