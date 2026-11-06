#!/usr/bin/env node
// LocalMC CraftManager - privilegierter Updater (nur Node-Bordmittel, eine einzige Datei).
//
// Läuft als root (Linux: craftmanager-update.service, ausgelöst von craftmanager-update.path) bzw. als SYSTEM
// (Windows: Dienst "craftmanager-updater" mit "watch"). Die Anwendung selbst läuft unprivilegiert und kann sich
// nicht selbst installieren; sie kann ein Update nur ANFORDERN:
//
//   <update-root>/request/     von der Anwendung beschreibbar: Paket, SHA256SUMS.txt, SHA256SUMS.txt.sig, request.json
//   <update-root>/status.json  nur von diesem Skript beschrieben, von der Anwendung nur gelesen
//   <update-root>/work/        nur root/SYSTEM: hierhin wird kopiert, hier wird geprüft und entpackt
//
// Vertrauenskette: Nichts aus request/ wird geglaubt. Die Dateien werden EINMAL in den geschützten Arbeitsordner
// kopiert (kein Symlink, Größenlimit, Hash über die kopierten Bytes), dort wird die Ed25519-Signatur von
// SHA256SUMS.txt mit den Schlüsseln der INSTALLIERTEN Version (tools/update-keys.json) geprüft, dann der SHA-256 des
// Pakets, dann Name, Version (streng neuer) und Zielsystem. Erst danach wird installiert; schlägt die
// Gesundheitsprüfung fehl, wird die vorherige Version wiederhergestellt.
//
// Aufruf:
//   node updater.mjs apply              eine Anfrage bearbeiten (Linux, systemd .path)
//   node updater.mjs watch              auf Anfragen warten (Windows-Dienst)
//   node updater.mjs install-job --job <Datei>   Installation aus einer Kopie heraus (Windows, Aufgabenplanung)
// Optionen: --update-root --install-dir --config-file --platform --stage-only (nur prüfen, nichts installieren)
import { spawn } from 'node:child_process';
import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { constants as fsc, existsSync, readFileSync } from 'node:fs';
import { chmod, copyFile, cp, lstat, mkdir, open, readFile, readdir, rename, rm, stat, writeFile, appendFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';

export const PROTOCOL = 1;
export const SUMS_NAME = 'SHA256SUMS.txt';
export const SIG_NAME = 'SHA256SUMS.txt.sig';
export const MAX_SUMS = 64 * 1024;
export const MAX_SIG = 1024;
export const MAX_REQUEST = 8 * 1024;
export const MAX_ASSET = 600 * 1024 * 1024;
export const ASSET_PATTERN = /^craftmanager-[0-9A-Za-z][0-9A-Za-z.+-]{0,60}-(?:setup\.exe|linux-(?:x64|arm64)\.tar\.gz)$/;
const TASK_NAME = 'CraftManagerUpdate';

export class UpdateError extends Error {
  constructor(message, code = 'FAILED') {
    super(message);
    this.name = 'UpdateError';
    this.code = code;
  }
}

// ---- Version -------------------------------------------------------------------------------------

const SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function parseSemver(text) {
  const match = SEMVER.exec(String(text).trim());
  if (match === null) return null;
  const nums = [match[1], match[2], match[3]].map(Number);
  if (nums.some((n) => !Number.isSafeInteger(n))) return null;
  const pre = match[4] === undefined ? [] : match[4].split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p));
  return { major: nums[0], minor: nums[1], patch: nums[2], pre };
}

export function compareSemver(a, b) {
  for (const key of ['major', 'minor', 'patch']) if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  if (a.pre.length === 0 && b.pre.length === 0) return 0;
  if (a.pre.length === 0) return 1;
  if (b.pre.length === 0) return -1;
  const length = Math.max(a.pre.length, b.pre.length);
  for (let i = 0; i < length; i++) {
    const l = a.pre[i];
    const r = b.pre[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    if (l === r) continue;
    if (typeof l === 'number' && typeof r === 'number') return l < r ? -1 : 1;
    if (typeof l === 'number') return -1;
    if (typeof r === 'number') return 1;
    return l < r ? -1 : 1;
  }
  return 0;
}

export function isNewerVersion(candidate, current) {
  const a = parseSemver(candidate);
  const b = parseSemver(current);
  return a !== null && b !== null && compareSemver(a, b) > 0;
}

// ---- Signatur und Prüfsummen -------------------------------------------------------------------------

export function decodeSignature(text) {
  const compact = String(text).replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null;
  const bytes = Buffer.from(compact, 'base64');
  return bytes.length === 64 ? bytes : null;
}

export function verifySumsSignature(sums, signatureText, keys) {
  const signature = decodeSignature(signatureText);
  if (signature === null) return false;
  for (const entry of keys) {
    try {
      const key = createPublicKey(entry.publicKey);
      if (key.asymmetricKeyType === 'ed25519' && cryptoVerify(null, sums, key, signature)) return true;
    } catch {
      // ein unbrauchbarer Schlüssel verifiziert nichts
    }
  }
  return false;
}

export function parseSums(text) {
  const map = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(trimmed);
    if (match === null) throw new UpdateError('Die Prüfsummen-Datei ist fehlerhaft.', 'SUMS');
    const name = match[2].trim();
    const hash = match[1].toLowerCase();
    if (map.has(name) && map.get(name) !== hash) throw new UpdateError('Die Prüfsummen-Datei ist widersprüchlich.', 'SUMS');
    map.set(name, hash);
  }
  return map;
}

export function expectedAssetName(version, target) {
  if (target === 'win-x64') return `craftmanager-${version}-setup.exe`;
  if (target === 'linux-x64' || target === 'linux-arm64') return `craftmanager-${version}-${target}.tar.gz`;
  return null;
}

// ---- Anfrage -----------------------------------------------------------------------------------------

export function validateRequest(raw) {
  if (typeof raw !== 'object' || raw === null) throw new UpdateError('Die Update-Anfrage ist ungültig.', 'REQUEST');
  const { schema, id, version, from, assetName, requestedAt } = raw;
  if (schema !== PROTOCOL) throw new UpdateError('Die Update-Anfrage hat ein unbekanntes Format.', 'REQUEST');
  if (typeof id !== 'string' || !/^[0-9A-Za-z-]{8,64}$/.test(id)) throw new UpdateError('Die Update-Anfrage hat eine ungültige Kennung.', 'REQUEST');
  if (typeof version !== 'string' || parseSemver(version) === null || version !== version.replace(/^v/, '')) {
    throw new UpdateError('Die Update-Anfrage nennt keine gültige Version.', 'REQUEST');
  }
  if (typeof from !== 'string' || from.length > 64) throw new UpdateError('Die Update-Anfrage ist ungültig.', 'REQUEST');
  if (typeof assetName !== 'string' || !ASSET_PATTERN.test(assetName)) throw new UpdateError('Die Update-Anfrage nennt keinen gültigen Dateinamen.', 'REQUEST');
  if (!Number.isInteger(requestedAt) || requestedAt < 0) throw new UpdateError('Die Update-Anfrage ist ungültig.', 'REQUEST');
  return { id, version, from, assetName };
}

// ---- sicheres Kopieren -------------------------------------------------------------------------------

// Kopiert genau EINE normale Datei aus dem (von der Anwendung beschreibbaren) Anfrageordner in den geschützten
// Arbeitsordner. Symlinks werden abgelehnt, die Größe ist begrenzt, der Hash entsteht aus den kopierten Bytes.
export async function copyRegularFile(sourceDir, name, destination, maxBytes) {
  const source = path.join(sourceDir, name);
  let info;
  try {
    info = await lstat(source);
  } catch {
    throw new UpdateError(`Die Datei „${name}“ fehlt in der Update-Anfrage.`, 'MISSING');
  }
  if (!info.isFile()) throw new UpdateError(`„${name}“ ist keine normale Datei und wird abgelehnt.`, 'NOT_REGULAR');
  const flags = fsc.O_RDONLY | (fsc.O_NOFOLLOW ?? 0);
  const input = await open(source, flags);
  const hash = createHash('sha256');
  let total = 0;
  try {
    const opened = await input.stat();
    if (!opened.isFile() || (opened.ino !== info.ino && process.platform !== 'win32')) throw new UpdateError(`„${name}“ hat sich während des Kopierens verändert.`, 'NOT_REGULAR');
    if (opened.size > maxBytes) throw new UpdateError(`„${name}“ ist größer als erlaubt.`, 'TOO_LARGE');
    const output = await open(destination, 'wx', 0o600);
    try {
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      for (;;) {
        const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
        if (bytesRead === 0) break;
        total += bytesRead;
        if (total > maxBytes) throw new UpdateError(`„${name}“ ist größer als erlaubt.`, 'TOO_LARGE');
        hash.update(buffer.subarray(0, bytesRead));
        await output.write(buffer, 0, bytesRead);
      }
    } finally {
      await output.close();
    }
  } finally {
    await input.close();
  }
  return { sha256: hash.digest('hex'), size: total };
}

// ---- Pfade und Kontext ---------------------------------------------------------------------------------

export function defaultPaths(platform, scriptDir) {
  if (platform === 'win32') {
    const programData = process.env.ProgramData ?? 'C:\\ProgramData';
    return {
      updateRoot: path.join(programData, 'LocalMC CraftManager Update'),
      installDir: path.resolve(scriptDir, '..'),
      configFile: path.join(programData, 'LocalMC CraftManager', 'craftmanager.env'),
    };
  }
  return { updateRoot: '/var/lib/craftmanager-update', installDir: '/opt/craftmanager', configFile: '/etc/craftmanager/craftmanager.env' };
}

export function createContext(overrides = {}) {
  const platform = overrides.platform ?? process.platform;
  const scriptDir = overrides.scriptDir ?? path.dirname(fileURLToPath(import.meta.url));
  const defaults = defaultPaths(platform, scriptDir);
  const updateRoot = overrides.updateRoot ?? defaults.updateRoot;
  return {
    platform,
    updateRoot,
    requestDir: overrides.requestDir ?? path.join(updateRoot, 'request'),
    workRoot: overrides.workRoot ?? path.join(updateRoot, 'work'),
    backupRoot: overrides.backupRoot ?? path.join(updateRoot, 'backup'),
    installDir: overrides.installDir ?? defaults.installDir,
    configFile: overrides.configFile ?? defaults.configFile,
    now: overrides.now ?? Date.now,
    sleep: overrides.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    fetch: overrides.fetch ?? globalThis.fetch,
    run: overrides.run ?? runCommand,
    healthTimeoutMs: overrides.healthTimeoutMs ?? 120_000,
    log: overrides.log ?? (() => undefined),
    stageOnly: overrides.stageOnly ?? false,
    scriptPath: overrides.scriptPath ?? fileURLToPath(import.meta.url),
  };
}

export async function writeStatus(ctx, status) {
  const body = { schema: PROTOCOL, id: status.id ?? '', state: status.state, version: status.version ?? '', from: status.from ?? '', message: status.message ?? '', updatedAt: ctx.now() };
  await mkdir(ctx.updateRoot, { recursive: true });
  const temp = path.join(ctx.updateRoot, `.status.${process.pid}.tmp`);
  await writeFile(temp, `${JSON.stringify(body)}\n`, { mode: 0o644 });
  if (process.platform !== 'win32') await chmod(temp, 0o644);
  await rename(temp, path.join(ctx.updateRoot, 'status.json'));
  ctx.log(`Status ${body.state}: ${body.message}`);
}

export function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    let output = '';
    let child;
    try {
      child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    } catch (error) {
      resolve({ code: -1, output: String(error) });
      return;
    }
    const collect = (chunk) => {
      output += chunk.toString();
      if (output.length > 200_000) output = output.slice(-100_000);
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.on('error', (error) => resolve({ code: -1, output: `${output}${error}` }));
    child.on('close', (code) => resolve({ code: code ?? -1, output }));
  });
}

async function readTrustedKeys(ctx) {
  const file = path.join(ctx.installDir, 'tools', 'update-keys.json');
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    const keys = Array.isArray(parsed.keys) ? parsed.keys.filter((k) => typeof k?.publicKey === 'string') : [];
    if (keys.length > 0) return keys;
  } catch {
    // unten gemeldet
  }
  throw new UpdateError('Die installierte Version enthält keine Update-Schlüssel (tools/update-keys.json). Das Update wird nicht eingespielt.', 'KEYS');
}

async function readInstalled(ctx) {
  try {
    const version = (await readFile(path.join(ctx.installDir, 'VERSION'), 'utf8')).trim();
    const info = JSON.parse(await readFile(path.join(ctx.installDir, 'version.json'), 'utf8'));
    if (parseSemver(version) === null || typeof info.target !== 'string') throw new Error('ungültig');
    return { version, target: info.target };
  } catch {
    throw new UpdateError('Die installierte Version konnte nicht bestimmt werden (VERSION / version.json).', 'INSTALLED');
  }
}

async function readRequestFile(ctx) {
  const info = await lstat(path.join(ctx.requestDir, 'request.json')).catch(() => null);
  if (info === null) return null;
  if (!info.isFile() || info.size > MAX_REQUEST) throw new UpdateError('Die Update-Anfrage ist ungültig.', 'REQUEST');
  const handle = await open(path.join(ctx.requestDir, 'request.json'), fsc.O_RDONLY | (fsc.O_NOFOLLOW ?? 0));
  try {
    const text = await handle.readFile({ encoding: 'utf8' });
    try {
      return JSON.parse(text);
    } catch {
      throw new UpdateError('Die Update-Anfrage ist kein gültiges JSON.', 'REQUEST');
    }
  } finally {
    await handle.close();
  }
}

async function clearRequest(ctx) {
  let names = [];
  try {
    names = await readdir(ctx.requestDir);
  } catch {
    return;
  }
  for (const name of names) {
    if (name === 'request.json' || name === SUMS_NAME || name === SIG_NAME || ASSET_PATTERN.test(name) || name.startsWith('.request.json.')) {
      await rm(path.join(ctx.requestDir, name), { force: true }).catch(() => undefined);
    }
  }
}

// ---- Anfrage prüfen und in den Arbeitsordner übernehmen ---------------------------------------------------------

export async function stageRequest(ctx) {
  let raw;
  try {
    raw = await readRequestFile(ctx);
  } catch (error) {
    // an unreadable request must not stay behind, or the trigger would fire again and again
    await clearRequest(ctx);
    throw Object.assign(error instanceof UpdateError ? error : new UpdateError('Die Update-Anfrage ist ungültig.', 'REQUEST'), { statusBase: { id: 'unbekannt', version: '', from: '' } });
  }
  if (raw === null) return null;
  const idHint = typeof raw?.id === 'string' && /^[0-9A-Za-z-]{8,64}$/.test(raw.id) ? raw.id : 'unbekannt';
  const base = { id: idHint, version: typeof raw?.version === 'string' ? raw.version.slice(0, 64) : '', from: typeof raw?.from === 'string' ? raw.from.slice(0, 64) : '' };
  let workDir = null;
  const fail = async (error) => {
    await clearRequest(ctx);
    if (workDir !== null) await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    throw Object.assign(error, { statusBase: base });
  };
  try {
    const request = validateRequest(raw);
    await writeStatus(ctx, { ...base, state: 'received', message: 'Update-Anfrage empfangen.' });
    const installed = await readInstalled(ctx);
    const keys = await readTrustedKeys(ctx);
    const expectedName = expectedAssetName(request.version, installed.target);
    if (expectedName === null || request.assetName !== expectedName) {
      throw new UpdateError(`Der Dateiname „${request.assetName}“ passt nicht zu Version ${request.version} für dieses System (${installed.target}).`, 'NAME');
    }
    if (!isNewerVersion(request.version, installed.version)) {
      throw new UpdateError(`Version ${request.version} ist nicht neuer als die installierte Version ${installed.version}.`, 'VERSION');
    }
    await writeStatus(ctx, { ...base, state: 'verifying', message: 'Signatur und Prüfsumme werden geprüft …' });
    workDir = path.join(ctx.workRoot, request.id);
    await rm(workDir, { recursive: true, force: true });
    await mkdir(workDir, { recursive: true, mode: 0o700 });
    // 1. kopieren (einmal lesen), danach nur noch mit den eigenen Kopien arbeiten
    const sums = await copyRegularFile(ctx.requestDir, SUMS_NAME, path.join(workDir, SUMS_NAME), MAX_SUMS);
    const sig = await copyRegularFile(ctx.requestDir, SIG_NAME, path.join(workDir, SIG_NAME), MAX_SIG);
    const asset = await copyRegularFile(ctx.requestDir, request.assetName, path.join(workDir, request.assetName), MAX_ASSET);
    await clearRequest(ctx);
    // 2. Signatur der Prüfsummen, 3. Hash des Pakets
    const sumsBytes = await readFile(path.join(workDir, SUMS_NAME));
    const sigText = await readFile(path.join(workDir, SIG_NAME), 'utf8');
    if (!verifySumsSignature(sumsBytes, sigText, keys)) {
      throw new UpdateError('Die Signatur des Releases ist ungültig. Das Update wurde aus Sicherheitsgründen abgelehnt.', 'SIGNATURE');
    }
    const expected = parseSums(sumsBytes.toString('utf8')).get(request.assetName);
    if (expected === undefined) throw new UpdateError(`In den signierten Prüfsummen steht „${request.assetName}“ nicht.`, 'SUMS');
    if (expected !== asset.sha256) throw new UpdateError('Das Paket passt nicht zur signierten Prüfsumme. Das Update wurde abgelehnt.', 'HASH');
    ctx.log(`Anfrage ${request.id} geprüft: ${request.assetName} (${asset.size} Bytes, sums ${sums.size}, sig ${sig.size})`);
    return { request, base, installed, workDir, assetPath: path.join(workDir, request.assetName) };
  } catch (error) {
    if (error instanceof UpdateError || error?.code === 'ENOENT') await fail(error instanceof UpdateError ? error : new UpdateError('Eine Datei der Update-Anfrage fehlt.', 'MISSING'));
    await fail(new UpdateError('Die Update-Anfrage konnte nicht geprüft werden.', 'INTERNAL'));
  }
  return null;
}

// ---- Gesundheitsprüfung -----------------------------------------------------------------------------------------

export function readConfig(configFile) {
  try {
    if (!existsSync(configFile)) return {};
    return parseEnv(readFileSync(configFile, 'utf8'));
  } catch {
    return {};
  }
}

// Adresse, unter der die Anwendung antwortet. Port und Adresse können in der Weboberfläche geändert worden sein; die
// Anwendung schreibt die tatsächlichen Werte nach <DATA_DIR>/network.json. Diese Datei beschreibt der Dienstkonto-Prozess,
// deshalb wird sie nur verwendet, wenn sie nach Schleife oder einer Adresse dieses Rechners aussieht (das Token geht nie
// an eine fremde Adresse).
export function healthTarget(config, configFile) {
  let port = Number(config.PORT ?? 3000);
  let host = config.HOST === undefined || config.HOST === '0.0.0.0' || config.HOST === '::' ? '127.0.0.1' : config.HOST;
  if (config.DATA_DIR !== undefined) {
    try {
      const info = JSON.parse(readFileSync(path.join(path.resolve(path.dirname(configFile), config.DATA_DIR), 'network.json'), 'utf8'));
      const local = new Set(['127.0.0.1']);
      for (const entries of Object.values(os.networkInterfaces())) for (const entry of entries ?? []) if (entry.family === 'IPv4' || entry.family === 4) local.add(entry.address);
      if (Number.isInteger(info.port) && info.port >= 1 && info.port <= 65535 && typeof info.probeHost === 'string' && net.isIPv4(info.probeHost) && local.has(info.probeHost)) {
        port = info.port;
        host = info.probeHost;
      }
    } catch {
      // keine oder unlesbare Datei: Werte der Konfiguration
    }
  }
  return { host, port };
}

export async function waitForVersion(ctx, expectedVersion) {
  const config = readConfig(ctx.configFile);
  const headers = config.AUTH_TOKEN ? { Authorization: `Bearer ${config.AUTH_TOKEN}` } : {};
  const deadline = ctx.now() + ctx.healthTimeoutMs;
  let last = 'keine Antwort';
  while (ctx.now() < deadline) {
    // jedes Mal neu lesen: die neue Version schreibt network.json erst, wenn sie lauscht
    const { host, port } = healthTarget(config, ctx.configFile);
    try {
      const response = await ctx.fetch(`http://${host.includes(':') ? `[${host}]` : host}:${port}/api/health`, { headers, signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const body = await response.json();
        if (body?.status === 'ok' && body?.version === expectedVersion) return { ok: true };
        last = body?.version === undefined ? 'Die Antwort nennt keine Version (Anmeldung?)' : `läuft als Version ${body.version}`;
      } else {
        last = `HTTP ${response.status}`;
      }
    } catch {
      last = 'keine Antwort';
    }
    await ctx.sleep(2000);
  }
  return { ok: false, detail: last };
}

// ---- Linux -------------------------------------------------------------------------------------------------------------

async function singleChildDir(dir) {
  const entries = (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  if (entries.length !== 1) throw new UpdateError('Das Paket hat nicht den erwarteten Aufbau.', 'PACKAGE');
  return path.join(dir, entries[0].name);
}

export async function installLinux(ctx, staged) {
  const { request, base, installed, workDir } = staged;
  const extractDir = path.join(workDir, 'extract');
  await mkdir(extractDir, { recursive: true, mode: 0o700 });
  await writeStatus(ctx, { ...base, state: 'installing', message: 'Das Paket wird entpackt …' });
  const tar = await ctx.run('tar', ['-xzf', staged.assetPath, '-C', extractDir, '--no-same-owner']);
  if (tar.code !== 0) throw new UpdateError('Das Paket ließ sich nicht entpacken.', 'PACKAGE');
  const packageDir = await singleChildDir(extractDir);
  const packageVersion = (await readFile(path.join(packageDir, 'VERSION'), 'utf8').catch(() => '')).trim();
  const packageInfo = JSON.parse(await readFile(path.join(packageDir, 'version.json'), 'utf8').catch(() => '{}'));
  if (packageVersion !== request.version || packageInfo.target !== installed.target) {
    throw new UpdateError(`Das Paket enthält Version ${packageVersion || '?'} für ${packageInfo.target ?? '?'}, erwartet war ${request.version} für ${installed.target}.`, 'PACKAGE');
  }
  if (ctx.stageOnly) return { stagedOnly: true, packageDir };

  await writeStatus(ctx, { ...base, state: 'installing', message: 'Die bisherige Version wird gesichert …' });
  const backupDir = path.join(ctx.backupRoot, 'current');
  await rm(ctx.backupRoot, { recursive: true, force: true });
  await mkdir(ctx.backupRoot, { recursive: true, mode: 0o700 });
  const copy = await ctx.run('cp', ['-a', ctx.installDir, backupDir]);
  if (copy.code !== 0) throw new UpdateError('Die bisherige Version ließ sich nicht sichern. Es wurde nichts verändert.', 'BACKUP');

  await writeStatus(ctx, { ...base, state: 'installing', message: 'Die neue Version wird installiert …' });
  const install = await ctx.run(path.join(packageDir, 'install.sh'), ['--upgrade'], { cwd: packageDir });
  ctx.log(`install.sh Ende ${install.code}\n${install.output.slice(-4000)}`);
  let healthy = false;
  if (install.code === 0) {
    await writeStatus(ctx, { ...base, state: 'health-check', message: 'Die neue Version wird geprüft …' });
    healthy = (await waitForVersion(ctx, request.version)).ok;
  }
  if (healthy) {
    await writeStatus(ctx, { ...base, state: 'done', message: `Auf Version ${request.version} aktualisiert.` });
    return { done: true };
  }
  return rollbackLinux(ctx, staged, backupDir, install.code === 0 ? 'Die neue Version antwortet nicht wie erwartet.' : `Die Installation ist fehlgeschlagen (Code ${install.code}).`);
}

export async function rollbackLinux(ctx, staged, backupDir, reason) {
  const { base, installed } = staged;
  await writeStatus(ctx, { ...base, state: 'installing', message: `${reason} Die bisherige Version wird wiederhergestellt …` });
  await ctx.run('systemctl', ['stop', 'craftmanager.service']);
  await rm(ctx.installDir, { recursive: true, force: true });
  await rm(`${ctx.installDir}.new`, { recursive: true, force: true });
  await rm(`${ctx.installDir}.old`, { recursive: true, force: true });
  const copy = await ctx.run('cp', ['-a', backupDir, ctx.installDir]);
  if (copy.code !== 0) {
    await writeStatus(ctx, { ...base, state: 'failed', message: `${reason} Die Wiederherstellung ist ebenfalls fehlgeschlagen. Bitte die vorherige Version von Hand installieren (Sicherung: ${backupDir}).` });
    return { done: false };
  }
  for (const unit of ['craftmanager.service', 'craftmanager-update.service', 'craftmanager-update.path']) {
    if (existsSync(path.join(ctx.installDir, unit))) await ctx.run('install', ['-m', '0644', '-o', 'root', '-g', 'root', path.join(ctx.installDir, unit), `/etc/systemd/system/${unit}`]);
  }
  await ctx.run('systemctl', ['daemon-reload']);
  await ctx.run('systemctl', ['start', 'craftmanager.service']);
  const health = await waitForVersion(ctx, installed.version);
  await writeStatus(ctx, {
    ...base,
    state: health.ok ? 'rolled-back' : 'failed',
    message: health.ok
      ? `${reason} Die vorherige Version ${installed.version} läuft wieder.`
      : `${reason} Die vorherige Version ${installed.version} wurde zurückgespielt, antwortet aber nicht. Bitte „journalctl -u craftmanager -e“ ansehen.`,
  });
  return { done: false };
}

// ---- Windows ---------------------------------------------------------------------------------------------------------------

export function taskXml(command, args) {
  const esc = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>LocalMC CraftManager Update (einmalig)</Description></RegistrationInfo>
  <Principals><Principal id="Author"><UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <Enabled>true</Enabled>
    <ExecutionTimeLimit>PT2H</ExecutionTimeLimit>
  </Settings>
  <Actions Context="Author"><Exec><Command>${esc(command)}</Command><Arguments>${esc(args)}</Arguments></Exec></Actions>
</Task>
`;
}

// Der Dienst "craftmanager-updater" darf nicht selbst installieren: Der Installer stoppt und ersetzt ihn. Deshalb
// wird eine Kopie von node.exe und diesem Skript abgelegt und über die Aufgabenplanung (außerhalb des Dienstes) gestartet.
export async function installWindows(ctx, staged) {
  const { request, base, installed, workDir } = staged;
  if (ctx.stageOnly) return { stagedOnly: true };
  const runnerDir = path.join(workDir, 'runner');
  await mkdir(runnerDir, { recursive: true, mode: 0o700 });
  const nodeCopy = path.join(runnerDir, 'node.exe');
  const scriptCopy = path.join(runnerDir, 'updater.mjs');
  await copyFile(path.join(ctx.installDir, 'node', 'node.exe'), nodeCopy);
  await copyFile(ctx.scriptPath, scriptCopy);
  // vorhandene Auswahl beibehalten: Firewall-Regeln und Startmenü nur, wenn sie schon da sind
  const firewall = (await ctx.run(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'netsh.exe'), ['advfirewall', 'firewall', 'show', 'rule', 'name=LocalMC CraftManager - Web'])).code === 0;
  const startmenu = existsSync(path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'LocalMC CraftManager'));
  const job = {
    id: request.id,
    version: request.version,
    from: installed.version,
    setup: staged.assetPath,
    workDir,
    updateRoot: ctx.updateRoot,
    installDir: ctx.installDir,
    configFile: ctx.configFile,
    backupRoot: ctx.backupRoot,
    tasks: [firewall ? 'firewall' : null, startmenu ? 'startmenu' : null].filter(Boolean),
  };
  const jobFile = path.join(workDir, 'job.json');
  await writeFile(jobFile, JSON.stringify(job), { mode: 0o600 });
  const xmlFile = path.join(workDir, 'task.xml');
  await writeFile(xmlFile, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(taskXml(nodeCopy, `"${scriptCopy}" install-job --job "${jobFile}"`), 'utf16le')]));
  const schtasks = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'schtasks.exe');
  await ctx.run(schtasks, ['/Delete', '/TN', TASK_NAME, '/F']);
  const created = await ctx.run(schtasks, ['/Create', '/TN', TASK_NAME, '/XML', xmlFile, '/F']);
  if (created.code !== 0) throw new UpdateError(`Die Aufgabe für die Installation konnte nicht angelegt werden (${created.output.trim().slice(-200)}).`, 'TASK');
  await writeStatus(ctx, { ...base, state: 'installing', message: 'Die Installation wird gestartet …' });
  const started = await ctx.run(schtasks, ['/Run', '/TN', TASK_NAME]);
  if (started.code !== 0) throw new UpdateError(`Die Installation ließ sich nicht starten (${started.output.trim().slice(-200)}).`, 'TASK');
  return { handedOver: true };
}

async function mirror(ctx, from, to) {
  const robocopy = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'robocopy.exe');
  const result = await ctx.run(robocopy, [from, to, '/MIR', '/R:2', '/W:2', '/NFL', '/NDL', '/NJH', '/NJS', '/NP']);
  // 0-7 bedeuten Erfolg (mit unterschiedlichen Kopierinfos), 8 und mehr einen Fehler
  return result.code >= 0 && result.code < 8;
}

// WinSW 2.x kennt kein "refresh" (erst WinSW 3): Ein Dienst wird gestoppt, mit "uninstall" entfernt, danach wird gewartet, bis er
// aus der Dienstverwaltung verschwunden ist (sc query -> 1060; "zum Löschen markiert" = 1072 geht vorbei, sobald kein Handle mehr
// offen ist), mit "install" neu eingetragen und das Konto gesetzt. Die Ausfallaktionen kommen bei "install" aus der XML-Datei.
export async function reregisterWindowsService(ctx, tool, id, account) {
  const system32 = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
  const sc = path.join(system32, 'sc.exe');
  await ctx.run(path.join(system32, 'net.exe'), ['stop', id]);
  if ((await ctx.run(sc, ['query', id])).code !== 1060) {
    if ((await ctx.run(tool, ['uninstall'])).code !== 0) await ctx.run(sc, ['delete', id]);
    for (let attempt = 0; attempt < 30; attempt++) {
      if ((await ctx.run(sc, ['query', id])).code === 1060) break;
      await ctx.sleep(1000);
    }
  }
  let installed = false;
  for (let attempt = 0; attempt < 30 && !installed; attempt++) {
    installed = (await ctx.run(tool, ['install'])).code === 0;
    if (!installed) await ctx.sleep(1000);
  }
  if (installed) installed = (await ctx.run(sc, ['config', id, 'obj=', account])).code === 0;
  if (!installed) ctx.log(`Der Dienst ${id} ließ sich nicht neu eintragen.`);
  return installed;
}

// Läuft aus der Kopie heraus (Aufgabenplanung, SYSTEM): sichern, Setup still ausführen, prüfen, ggf. zurückrollen.
export async function runWindowsJob(ctx, job) {
  const base = { id: job.id, version: job.version, from: job.from };
  const system32 = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
  const serviceTool = path.join(job.installDir, 'craftmanager-service.exe');
  const updaterTool = path.join(job.installDir, 'craftmanager-updater-service.exe');
  const backupDir = path.join(job.backupRoot, 'current');
  try {
    await writeStatus(ctx, { ...base, state: 'installing', message: 'Die bisherige Version wird gesichert …' });
    await rm(job.backupRoot, { recursive: true, force: true });
    await mkdir(job.backupRoot, { recursive: true });
    if (!(await mirror(ctx, job.installDir, backupDir))) throw new UpdateError('Die bisherige Version ließ sich nicht sichern. Es wurde nichts verändert.', 'BACKUP');

    await writeStatus(ctx, { ...base, state: 'installing', message: 'Das Installationsprogramm läuft …' });
    const args = ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/NOCANCEL', `/LOG=${path.join(job.updateRoot, `setup-${job.id}.log`)}`, `/TASKS=${job.tasks.join(',')}`];
    const setup = await ctx.run(job.setup, args);
    ctx.log(`setup.exe Ende ${setup.code}`);
    let healthy = false;
    if (setup.code === 0) {
      await writeStatus(ctx, { ...base, state: 'health-check', message: 'Die neue Version wird geprüft …' });
      healthy = (await waitForVersion({ ...ctx, configFile: job.configFile }, job.version)).ok;
    }
    if (healthy) {
      await writeStatus(ctx, { ...base, state: 'done', message: `Auf Version ${job.version} aktualisiert.` });
      return true;
    }
    const reason = setup.code === 0 ? 'Die neue Version antwortet nicht wie erwartet.' : `Die Installation ist fehlgeschlagen (Code ${setup.code}).`;
    await writeStatus(ctx, { ...base, state: 'installing', message: `${reason} Die bisherige Version wird wiederhergestellt …` });
    await ctx.run(path.join(system32, 'net.exe'), ['stop', 'craftmanager']);
    await ctx.run(path.join(system32, 'net.exe'), ['stop', 'craftmanager-updater']);
    const restored = await mirror(ctx, backupDir, job.installDir);
    if (restored) {
      // WinSW 2.x has no "refresh": the services are registered again from the restored files
      await reregisterWindowsService(ctx, serviceTool, 'craftmanager', 'NT SERVICE\\craftmanager');
      await reregisterWindowsService(ctx, updaterTool, 'craftmanager-updater', 'LocalSystem');
      await ctx.run(path.join(system32, 'net.exe'), ['start', 'craftmanager']);
      await ctx.run(path.join(system32, 'net.exe'), ['start', 'craftmanager-updater']);
    }
    const back = restored ? await waitForVersion({ ...ctx, configFile: job.configFile }, job.from) : { ok: false };
    await writeStatus(ctx, {
      ...base,
      state: back.ok ? 'rolled-back' : 'failed',
      message: back.ok
        ? `${reason} Die vorherige Version ${job.from} läuft wieder.`
        : `${reason} Die vorherige Version ${job.from} konnte nicht wiederhergestellt werden. Bitte das Installationsprogramm der vorherigen Version von Hand ausführen.`,
    });
    return false;
  } catch (error) {
    const message = error instanceof UpdateError ? error.message : 'Das Update ist aus einem unerwarteten Grund fehlgeschlagen.';
    ctx.log(`Fehler: ${error instanceof Error ? error.stack : error}`);
    await writeStatus(ctx, { ...base, state: 'failed', message });
    return false;
  } finally {
    // Deleting the scheduled task may end this very process: lock and work files go first, the task last
    // (the runner's node.exe stays locked until the end; the next request clears what is left in work\)
    await rm(path.join(job.updateRoot, 'update.lock'), { force: true }).catch(() => undefined);
    await rm(job.workDir, { recursive: true, force: true }).catch(() => undefined);
    await ctx.run(path.join(system32, 'schtasks.exe'), ['/Delete', '/TN', TASK_NAME, '/F']);
  }
}

// ---- Ablauf -------------------------------------------------------------------------------------------------------------------

async function acquireLock(ctx) {
  const file = path.join(ctx.updateRoot, 'update.lock');
  await mkdir(ctx.updateRoot, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(file, 'wx', 0o600);
      await handle.writeFile(`${process.pid} ${ctx.now()}\n`);
      await handle.close();
      return async () => rm(file, { force: true });
    } catch {
      const age = ctx.now() - (await stat(file).catch(() => ({ mtimeMs: ctx.now() }))).mtimeMs;
      if (age < 3 * 3600_000) return null;
      await rm(file, { force: true });
    }
  }
  return null;
}

// Eine Anfrage bearbeiten. Gibt false zurück, wenn keine vorlag.
export async function processRequest(ctx) {
  const release = await acquireLock(ctx);
  if (release === null) {
    ctx.log('Ein anderes Update läuft bereits.');
    return false;
  }
  let handedOver = false;
  try {
    // we hold the lock, so no job is using the work folder: leftovers of earlier runs go
    await rm(ctx.workRoot, { recursive: true, force: true }).catch(() => undefined);
    await mkdir(ctx.workRoot, { recursive: true, mode: 0o700 });
    const staged = await stageRequest(ctx);
    if (staged === null) return false;
    try {
      const result = ctx.platform === 'win32' ? await installWindows(ctx, staged) : await installLinux(ctx, staged);
      handedOver = result?.handedOver === true;
      if (result?.stagedOnly === true) await writeStatus(ctx, { ...staged.base, state: 'done', message: `Prüfung bestanden (nur Prüfung): ${staged.request.assetName}` });
    } catch (error) {
      const message = error instanceof UpdateError ? error.message : 'Das Update ist aus einem unerwarteten Grund fehlgeschlagen.';
      ctx.log(`Fehler: ${error instanceof Error ? error.stack : error}`);
      await writeStatus(ctx, { ...staged.base, state: 'failed', message });
    } finally {
      if (!handedOver) await rm(staged.workDir, { recursive: true, force: true }).catch(() => undefined);
    }
    return true;
  } catch (error) {
    const message = error instanceof UpdateError ? error.message : 'Die Update-Anfrage konnte nicht bearbeitet werden.';
    ctx.log(`Fehler: ${error instanceof Error ? error.stack : error}`);
    await writeStatus(ctx, { ...(error.statusBase ?? { id: 'unbekannt' }), state: 'failed', message });
    return true;
  } finally {
    // after a hand-over the installation job owns the lock and releases it at its end
    if (!handedOver) await release();
  }
}

async function appendLog(ctx, message) {
  const file = path.join(ctx.updateRoot, 'updater.log');
  try {
    await mkdir(ctx.updateRoot, { recursive: true });
    const size = (await stat(file).catch(() => ({ size: 0 }))).size;
    if (size > 1_000_000) await rename(file, `${file}.1`).catch(() => undefined);
    await appendFile(file, `${new Date(ctx.now()).toISOString()} ${message}\n`);
  } catch {
    // Protokoll ist Zugabe
  }
}

export async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      'update-root': { type: 'string' },
      'install-dir': { type: 'string' },
      'config-file': { type: 'string' },
      platform: { type: 'string' },
      job: { type: 'string' },
      'stage-only': { type: 'boolean', default: false },
    },
  });
  const command = positionals[0];
  const overrides = {
    ...(values['update-root'] === undefined ? {} : { updateRoot: path.resolve(values['update-root']) }),
    ...(values['install-dir'] === undefined ? {} : { installDir: path.resolve(values['install-dir']) }),
    ...(values['config-file'] === undefined ? {} : { configFile: path.resolve(values['config-file']) }),
    ...(values.platform === undefined ? {} : { platform: values.platform }),
    stageOnly: values['stage-only'],
  };
  const ctx = createContext(overrides);
  let chain = Promise.resolve();
  ctx.log = (message) => {
    console.log(message);
    chain = chain.then(() => appendLog(ctx, message));
  };
  if (command === 'apply') {
    if (ctx.platform !== 'win32' && !ctx.stageOnly && typeof process.getuid === 'function' && process.getuid() !== 0) {
      console.error('Der Updater muss als root laufen.');
      return 2;
    }
    await processRequest(ctx);
  } else if (command === 'watch') {
    let stop = false;
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(signal, () => (stop = true));
    ctx.log(`Update-Dienst wartet auf Anfragen in ${ctx.requestDir}`);
    while (!stop) {
      try {
        if (existsSync(path.join(ctx.requestDir, 'request.json'))) await processRequest(ctx);
      } catch (error) {
        ctx.log(`Fehler in der Warteschleife: ${error instanceof Error ? error.message : error}`);
      }
      await ctx.sleep(2000);
    }
  } else if (command === 'install-job') {
    if (values.job === undefined) {
      console.error('--job fehlt.');
      return 2;
    }
    const job = JSON.parse(await readFile(path.resolve(values.job), 'utf8'));
    const jobCtx = createContext({ ...overrides, updateRoot: job.updateRoot, installDir: job.installDir, configFile: job.configFile });
    jobCtx.log = ctx.log;
    await runWindowsJob(jobCtx, job);
  } else {
    console.error('Verwendung: node updater.mjs apply | watch | install-job --job <Datei>');
    return 2;
  }
  await chain;
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.stack : error);
      process.exit(1);
    },
  );
}
