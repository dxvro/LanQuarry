#!/usr/bin/env node
// Baut ein installierbares Paket für win-x64, linux-x64 oder linux-arm64.
//   npm run package -- --target win-x64
// Ergebnis: release/<Ziel>/ (Dateibaum) und release/craftmanager-<Version>-<Ziel>.(zip|tar.gz)
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTarGz, readZip, writeTarGz, writeZip } from './lib/archive.mjs';
import { lookupShasum, parseShasums, sha256File } from './lib/checksums.mjs';
import { downloadVerified, fetchText } from './lib/download.mjs';
import { machineMatches, readMachineFromFile } from './lib/native.mjs';
import { NODE_ALLOWED_HOSTS, WINSW } from './lib/pins.mjs';
import { collectPackages, formatNotices } from './lib/notices.mjs';
import { NODE_DIST_BASE, nodeArchiveEntries, nodeBinaryMode, nodeDistUrl, selectLts, writeExecutable } from './lib/node-dist.mjs';
import { describeSpawnFailure } from './lib/probe.mjs';
import { runNpm, stageProduction } from './lib/stage.mjs';
import { getTarget, hostTargetName, nodeArchiveName, parseArgs, releaseBaseName, TARGET_NAMES } from './lib/targets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE = path.join(ROOT, 'release');
const CACHE = path.join(RELEASE, '.cache');
const log = (message) => console.log(message);

const HELP = `Verwendung: node scripts/package.mjs --target <${TARGET_NAMES.join('|')}> [Optionen]

  --target <Ziel>          Zielsystem (Pflicht)
  --skip-build             vorhandenen Build (npm run build) verwenden
  --skip-smoke             Startprüfung der Laufzeit auf dem Build-Rechner überspringen
  --no-archive             nur den Ordner release/<Ziel>/ bauen
  --node-version vX.Y.Z    bestimmte Node.js-Version statt der neuesten LTS
  --out <Ordner>           Ausgabeordner statt release/
`;

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function walk(dir, base = dir) {
  const result = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push({ rel: path.relative(base, full).split(path.sep).join('/'), type: 'dir', file: full });
      result.push(...(await walk(full, base)));
    } else if (entry.isFile()) {
      result.push({ rel: path.relative(base, full).split(path.sep).join('/'), type: 'file', file: full });
    }
  }
  return result;
}

// Dateirechte im Archiv: Skripte und die Node-Programmdatei ausführbar, alles andere normal
const EXECUTABLES = new Set(['install.sh', 'uninstall.sh', 'node/node']);
const modeFor = (rel, type) => (type === 'dir' ? 0o755 : EXECUTABLES.has(rel) ? 0o755 : 0o644);

async function resolveNode(target, requested) {
  let version = requested;
  if (version === null) {
    log('Ermittle die aktuelle Node.js-LTS-Version ...');
    version = selectLts(JSON.parse(await fetchText(`${NODE_DIST_BASE}/index.json`, NODE_ALLOWED_HOSTS)));
  }
  const shasums = parseShasums(await fetchText(nodeDistUrl(version, 'SHASUMS256.txt'), NODE_ALLOWED_HOSTS));
  const archiveName = nodeArchiveName(version, target);
  const archive = await downloadVerified({
    url: nodeDistUrl(version, archiveName),
    allowedHosts: NODE_ALLOWED_HOSTS,
    destination: path.join(CACHE, archiveName),
    sha256: lookupShasum(shasums, archiveName),
    label: `Node.js ${version} (${target.name})`,
  });
  return { version, archive };
}

async function extractNode({ version, archive }, target, outDir) {
  const entries = target.archiveKind === 'zip' ? await readZip(archive) : await readTarGz(archive);
  const wanted = nodeArchiveEntries(version, target);
  const binary = entries.find((e) => e.path === wanted.binary);
  const license = entries.find((e) => e.path === wanted.license);
  if (binary === undefined || license === undefined) throw new Error(`Node-Archiv enthält ${wanted.binary} oder ${wanted.license} nicht.`);
  const dir = path.join(outDir, 'node');
  await mkdir(dir, { recursive: true });
  // Ausführbit aus dem tar-Eintrag übernehmen: ohne es scheitert der Start unter Linux mit EACCES
  await writeExecutable(path.join(dir, target.nodeBinaryName), binary.data, nodeBinaryMode(binary.mode, target));
  const licenseText = license.data.toString('utf8');
  await writeFile(path.join(dir, 'LICENSE-node.txt'), licenseText);
  return licenseText;
}

function build() {
  log('Baue Frontend und Backend (npm run build) ...');
  runNpm(['run', 'build'], { cwd: ROOT });
}

async function copyApp(outDir, version) {
  const backendSrc = path.join(ROOT, 'packages', 'backend');
  const backendDest = path.join(outDir, 'app', 'backend');
  const distSrc = path.join(backendSrc, 'dist');
  if (!existsSync(path.join(distSrc, 'index.js'))) throw new Error('packages/backend/dist/index.js fehlt. Ohne --skip-build bauen.');
  const frontendDist = path.join(ROOT, 'packages', 'frontend', 'dist');
  if (!existsSync(path.join(frontendDist, 'index.html'))) throw new Error('packages/frontend/dist/index.html fehlt. Ohne --skip-build bauen.');
  await cp(distSrc, path.join(backendDest, 'dist'), { recursive: true, filter: (src) => !src.endsWith('.map') });
  await cp(path.join(backendSrc, 'drizzle'), path.join(backendDest, 'drizzle'), { recursive: true });
  // schlanke package.json: readVersion() liest die Version, "type" macht dist/ zu ESM
  const backendPackage = await readJson(path.join(backendSrc, 'package.json'));
  await writeFile(
    path.join(backendDest, 'package.json'),
    `${JSON.stringify({ name: backendPackage.name, version: backendPackage.version ?? version, private: true, type: 'module', main: 'dist/index.js' }, null, 2)}\n`,
  );
  await cp(frontendDist, path.join(outDir, 'app', 'frontend', 'dist'), { recursive: true });
}

async function copyPlatformFiles(outDir, target) {
  const common = path.join(ROOT, 'installer', 'common');
  const tools = path.join(outDir, 'tools');
  await mkdir(tools, { recursive: true });
  await cp(path.join(common, 'setup-config.mjs'), path.join(tools, 'setup-config.mjs'));
  await cp(path.join(common, 'craftmanager.env.template'), path.join(tools, 'craftmanager.env.template'));
  await cp(path.join(ROOT, 'scripts', 'lib', 'config.mjs'), path.join(tools, 'config.mjs'));
  if (target.platform === 'win32') {
    const dir = path.join(ROOT, 'installer', 'windows');
    await cp(path.join(dir, 'craftmanager-service.xml'), path.join(outDir, 'craftmanager-service.xml'));
    await cp(path.join(dir, 'start-portable.cmd'), path.join(outDir, 'start-portable.cmd'));
    await cp(path.join(dir, 'LIESMICH.txt'), path.join(outDir, 'LIESMICH.txt'));
    const winsw = await downloadVerified({
      url: WINSW.url,
      allowedHosts: WINSW.allowedHosts,
      destination: path.join(CACHE, WINSW.fileName),
      sha256: WINSW.sha256,
      label: `WinSW ${WINSW.version}`,
    });
    await cp(winsw, path.join(outDir, 'craftmanager-service.exe'));
    await cp(path.join(dir, 'WinSW-LICENSE.txt'), path.join(outDir, 'tools', 'LICENSE-WinSW.txt'));
  } else {
    const dir = path.join(ROOT, 'installer', 'linux');
    for (const name of ['install.sh', 'uninstall.sh', 'craftmanager.service', 'LIESMICH.txt']) {
      // Shell-Skripte müssen LF-Zeilenenden haben, auch wenn der Checkout unter Windows CRLF erzeugt hat
      const text = (await readFile(path.join(dir, name), 'utf8')).replace(/\r\n/g, '\n');
      await writeFile(path.join(outDir, name), text);
    }
  }
}

// Startprüfung: nur möglich, wenn das Zielsystem dem Build-Rechner entspricht
function smokeTest(outDir, target) {
  const nodeBinary = path.join(outDir, 'node', target.nodeBinaryName);
  const backend = path.join(outDir, 'app', 'backend');
  const code = `
    import { pathToFileURL } from 'node:url';
    import path from 'node:path';
    const { createClient } = await import('@libsql/client');
    const client = createClient({ url: ':memory:' });
    const row = (await client.execute('select sqlite_version() as v')).rows[0];
    client.close();
    await import(pathToFileURL(path.resolve('dist', 'app.js')).href);
    console.log('libsql ok, SQLite ' + row.v);
  `;
  const result = spawnSync(nodeBinary, ['--input-type=module', '-e', code], { cwd: backend, encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`Startprüfung mit dem mitgelieferten Node fehlgeschlagen:\n${describeSpawnFailure(result)}`);
  }
  log(`  Startprüfung (mitgelieferter Node ${path.basename(nodeBinary)}): ${result.stdout.trim()}`);
}

async function writeArchive(outDir, archivePath, prefix, target) {
  const entries = [{ path: prefix, type: 'dir', mode: 0o755 }];
  for (const item of await walk(outDir)) {
    entries.push({ path: `${prefix}/${item.rel}`, type: item.type, mode: modeFor(item.rel, item.type), file: item.file });
  }
  const mtime = Number(process.env.SOURCE_DATE_EPOCH ?? Math.floor(Date.now() / 1000));
  if (target.archiveKind === 'zip') await writeZip(archivePath, entries);
  else await writeTarGz(archivePath, entries, mtime);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    log(HELP);
    return;
  }
  const target = getTarget(options.target);
  const releaseDir = options.outDir === null ? RELEASE : path.resolve(options.outDir);
  const outDir = path.join(releaseDir, target.name);
  const backendPackage = await readJson(path.join(ROOT, 'packages', 'backend', 'package.json'));
  const version = backendPackage.version;
  const prefix = releaseBaseName(version, target);

  log(`Paket ${prefix} (Build-Rechner: ${os.platform()}-${os.arch()})`);
  if (!options.skipBuild) build();

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  log('Kopiere Anwendung ...');
  await copyApp(outDir, version);

  const stagingDir = path.join(releaseDir, '.stage', target.name);
  const nodeModules = await stageProduction({ root: ROOT, stagingDir, target, log });
  await cp(nodeModules, path.join(outDir, 'app', 'node_modules'), { recursive: true });
  await rm(stagingDir, { recursive: true, force: true });

  const nativeFile = path.join(outDir, 'app', 'node_modules', ...target.libsql.split('/'), 'index.node');
  const machine = await readMachineFromFile(nativeFile);
  if (!machineMatches(machine, target.machine)) {
    throw new Error(`${target.libsql}/index.node hat nicht die Architektur von ${target.name} (gefunden: ${JSON.stringify(machine)}).`);
  }
  log(`  native Bibliothek ${target.libsql}: ${machine.format.toUpperCase()}-Kopf passt zu ${target.name}`);

  log('Lade Node.js ...');
  const node = await resolveNode(target, options.nodeVersion);
  const nodeLicense = await extractNode(node, target, outDir);
  const nodeMachine = await readMachineFromFile(path.join(outDir, 'node', target.nodeBinaryName));
  if (!machineMatches(nodeMachine, target.machine)) {
    throw new Error(`Die Node-Programmdatei hat nicht die Architektur von ${target.name} (gefunden: ${JSON.stringify(nodeMachine)}).`);
  }
  log(`  Node-Programmdatei: ${nodeMachine.format.toUpperCase()}-Kopf passt zu ${target.name}`);

  log('Kopiere Installationsdateien ...');
  await copyPlatformFiles(outDir, target);

  const licenseSource = path.join(ROOT, 'LICENSE');
  await writeFile(
    path.join(outDir, 'LICENSE.txt'),
    existsSync(licenseSource)
      ? await readFile(licenseSource)
      : 'LocalMC CraftManager\nAlle Rechte vorbehalten. Eine Lizenz für die Weitergabe wurde noch nicht festgelegt.\nLizenzen der enthaltenen Komponenten: siehe THIRD-PARTY-NOTICES.txt.\n',
  );
  const extras = [{ name: 'Node.js', version: node.version, license: 'MIT und weitere (siehe Text)', text: nodeLicense.trim() }];
  if (target.platform === 'win32') {
    extras.push({ name: 'WinSW', version: WINSW.version, license: WINSW.license, text: (await readFile(path.join(ROOT, 'installer', 'windows', 'WinSW-LICENSE.txt'), 'utf8')).trim() });
  }
  const packages = await collectPackages(path.join(outDir, 'app', 'node_modules'));
  await writeFile(path.join(outDir, 'THIRD-PARTY-NOTICES.txt'), formatNotices({ productName: 'LocalMC CraftManager', packages, extras }));

  await writeFile(path.join(outDir, 'VERSION'), `${version}\n`);
  await writeFile(
    path.join(outDir, 'version.json'),
    `${JSON.stringify({ name: 'LocalMC CraftManager', version, target: target.name, node: node.version, ...(target.platform === 'win32' ? { winsw: WINSW.version } : {}), builtAt: new Date().toISOString() }, null, 2)}\n`,
  );

  if (!options.skipSmoke && hostTargetName() === target.name) smokeTest(outDir, target);
  else log(`  Startprüfung übersprungen (Ziel ${target.name} ≠ Build-Rechner)`);

  const summary = [];
  if (!options.noArchive) {
    const archivePath = path.join(releaseDir, `${prefix}.${target.archiveKind}`);
    log(`Schreibe ${path.basename(archivePath)} ...`);
    await rm(archivePath, { force: true });
    await writeArchive(outDir, archivePath, prefix, target);
    const hash = await sha256File(archivePath);
    await writeFile(`${archivePath}.sha256`, `${hash}  ${path.basename(archivePath)}\n`);
    summary.push(`${archivePath}  ${((await stat(archivePath)).size / 1048576).toFixed(1)} MB  sha256=${hash}`);
  }
  log(`\nFertig: ${outDir}`);
  for (const line of summary) log(line);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
