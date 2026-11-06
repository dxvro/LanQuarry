import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../http/errors.js';
import type { Loader } from '../db/enums.js';
import { listModFiles, mapLimit } from '../mods/files.js';
import type { DetectedModDto, ImportAnalysisDto, ImportNotice, ModLoaderDto } from './dto.js';
import { detectStagedWorld, type StagedWorld } from './layout.js';
import { parseLevelDat, type LevelInfo } from './level-dat.js';
import { parseManifest, type ExportManifest } from './manifest.js';
import { hashFileBoth, readJarMeta, type JarMeta } from './mod-meta.js';

// Everything the import keeps about an analysed archive, including absolute paths the DTO must not expose
export interface FactMod extends DetectedModDto {
  path: string | null;
  minecraft: string | null;
}

export interface ImportFacts {
  world: StagedWorld;
  level: LevelInfo;
  manifest: ExportManifest | null;
  mods: FactMod[];
  unreadableJars: string[];
}

const MAX_JARS = 3000;
const HASH_CONCURRENCY = 4;
const IGNORED_MOD_IDS = new Set(['minecraft', 'java', 'fabricloader', 'fabric-loader', 'forge', 'neoforge', 'fml', 'mcp', 'javafml', 'lowcodefml']);

export const isBuiltInModId = (id: string): boolean => IGNORED_MOD_IDS.has(id.toLowerCase());

const toLoaderDto = (meta: JarMeta): ModLoaderDto[] => meta.loaders;

async function readJars(world: StagedWorld, facts: { mods: FactMod[]; unreadable: string[] }): Promise<void> {
  for (const dir of ['mods', 'plugins'] as const) {
    const abs = world.modDirs[dir];
    if (abs === null) continue;
    const files = await listModFiles(abs);
    if (facts.mods.length + files.length > MAX_JARS) {
      throw new AppError(422, 'IMPORT_TOO_MANY_MODS', `Das Archiv enthält mehr als ${MAX_JARS} Mod-Dateien und wird nicht importiert.`);
    }
    const results = await mapLimit(files, HASH_CONCURRENCY, async (file): Promise<FactMod> => {
      const full = path.join(abs, file.diskName);
      const hashes = await hashFileBoth(full);
      let meta: JarMeta | null = null;
      try {
        meta = await readJarMeta(full);
      } catch {
        facts.unreadable.push(file.fileName);
      }
      return {
        key: `jar:${dir}/${file.fileName}`,
        modId: meta?.modId ?? null,
        name: meta?.name ?? meta?.modId ?? file.fileName.replace(/\.jar$/i, ''),
        version: meta?.version ?? null,
        fileName: file.fileName,
        enabled: file.enabled,
        sha1: hashes.sha1,
        sha512: hashes.sha512,
        sizeBytes: hashes.size,
        loaders: meta === null ? [] : toLoaderDto(meta),
        side: meta?.side ?? 'unknown',
        origin: 'jar',
        projectId: null,
        versionId: null,
        dir,
        minecraft: meta?.minecraft ?? null,
        path: full,
      };
    });
    facts.mods.push(...results);
  }
}

function mergeManifest(mods: FactMod[], manifest: ExportManifest | null): void {
  if (manifest === null) return;
  for (const entry of manifest.mods) {
    const jar = mods.find(
      (mod) =>
        mod.origin === 'jar' &&
        mod.dir === entry.dir &&
        ((entry.sha512 !== null && mod.sha512 === entry.sha512) || (entry.sha512 === null && mod.fileName === entry.fileName)),
    );
    if (jar !== undefined) {
      jar.projectId = entry.projectId;
      jar.versionId = entry.versionId;
      jar.enabled = entry.enabled;
      if (jar.side === 'unknown') jar.side = entry.side;
      jar.modId ??= entry.modId;
      continue;
    }
    mods.push({
      key: `manifest:${entry.dir}/${entry.fileName}`,
      modId: entry.modId,
      name: entry.name,
      version: entry.version,
      fileName: entry.fileName,
      enabled: entry.enabled,
      sha1: entry.sha1,
      sha512: entry.sha512,
      sizeBytes: entry.sizeBytes,
      loaders: [],
      side: entry.side,
      origin: 'manifest',
      projectId: entry.projectId,
      versionId: entry.versionId,
      dir: entry.dir,
      minecraft: null,
      path: null,
    });
  }
}

function mergeForgeList(mods: FactMod[], level: LevelInfo): void {
  const known = new Set<string>();
  for (const mod of mods) {
    if (mod.modId !== null) known.add(mod.modId.toLowerCase());
  }
  for (const entry of level.forgeMods) {
    if (known.has(entry.id.toLowerCase())) continue;
    // the same mod may be listed under another id of a multi-mod jar
    mods.push({
      key: `fml:${entry.id}`,
      modId: entry.id,
      name: entry.id,
      version: entry.version,
      fileName: null,
      enabled: true,
      sha1: null,
      sha512: null,
      sizeBytes: 0,
      loaders: [],
      side: 'unknown',
      origin: 'level.dat',
      projectId: null,
      versionId: null,
      dir: 'mods',
      minecraft: null,
      path: null,
    });
  }
}

export interface LoaderProposal {
  loader: Loader;
  evidence: string[];
  // a loader version taken from the world or the export, to prefer when picking from the catalog
  versionHint: string | null;
}

const LOADER_NAME: Record<Loader, string> = { vanilla: 'Vanilla', fabric: 'Fabric', paper: 'Paper', forge: 'Forge', neoforge: 'NeoForge' };

export function proposeLoader(facts: Pick<ImportFacts, 'world' | 'level' | 'manifest' | 'mods'>): LoaderProposal {
  const { world, level, manifest, mods } = facts;
  const evidence: string[] = [];
  if (manifest !== null) {
    evidence.push(`Die Export-Datei nennt ${LOADER_NAME[manifest.server.loader]}${manifest.server.loaderVersion === null ? '' : ` ${manifest.server.loaderVersion}`}.`);
    return { loader: manifest.server.loader, evidence, versionHint: manifest.server.loaderVersion };
  }
  const votes = new Map<Loader, number>();
  const vote = (loader: Loader, text: string, weight = 1): void => {
    votes.set(loader, (votes.get(loader) ?? 0) + weight);
    evidence.push(text);
  };
  const jarLoaders = (mod: FactMod): Loader[] => {
    const out = new Set<Loader>();
    for (const l of mod.loaders) out.add(l === 'quilt' ? 'fabric' : l);
    return [...out];
  };
  const counts = new Map<Loader, number>();
  for (const mod of mods) if (mod.origin === 'jar') for (const l of jarLoaders(mod)) counts.set(l, (counts.get(l) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best !== undefined) vote(best[0], `${best[1]} Datei(en) im Archiv gehören zu ${LOADER_NAME[best[0]]}.`, 4);

  if (level.fml) {
    const mc = level.mcVersion;
    const parts = mc === null ? [] : mc.split('.').map(Number);
    const modernNeo = level.neoforgeVersion !== null || (parts[0] === 1 && ((parts[1] ?? 0) > 20 || ((parts[1] ?? 0) === 20 && (parts[2] ?? 0) >= 5)));
    if (level.neoforgeVersion !== null) vote('neoforge', 'level.dat enthält eine NeoForge-Modliste.', 3);
    else if (level.forgeVersion !== null) vote('forge', 'level.dat enthält eine Forge-Modliste.', 3);
    else vote(modernNeo ? 'neoforge' : 'forge', 'level.dat enthält einen Forge-Abschnitt (FML).', 2);
  }
  for (const brand of level.serverBrands) {
    const lower = brand.toLowerCase();
    if (lower === 'fabric') vote('fabric', 'level.dat nennt die Server-Marke „fabric“.', 2);
    else if (lower === 'forge') vote('forge', 'level.dat nennt die Server-Marke „forge“.', 2);
    else if (lower === 'neoforge') vote('neoforge', 'level.dat nennt die Server-Marke „neoforge“.', 2);
    else if (lower === 'paper' || lower === 'spigot' || lower === 'purpur' || lower === 'folia') vote('paper', `level.dat nennt die Server-Marke „${brand}“.`, 2);
  }
  if (world.paperHints.length > 0) vote('paper', `Hinweis auf Bukkit/Paper: ${world.paperHints.join(', ')}.`, 2);

  const winner = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  if (winner === undefined) return { loader: 'vanilla', evidence: ['Keine Hinweise auf Mods oder Plugins gefunden.'], versionHint: null };
  const hint = winner[0] === 'forge' ? level.forgeVersion : winner[0] === 'neoforge' ? level.neoforgeVersion : null;
  return { loader: winner[0], evidence, versionHint: hint };
}

export async function gatherFacts(stageRoot: string): Promise<ImportFacts> {
  const world = await detectStagedWorld(stageRoot);
  let level: LevelInfo;
  try {
    level = parseLevelDat(await readFile(path.join(world.worldDir, 'level.dat')));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(422, 'LEVEL_DAT_INVALID', 'Die Datei level.dat konnte nicht gelesen werden.');
  }
  let manifest: ExportManifest | null = null;
  if (world.manifestFile !== null) manifest = parseManifest(await readFile(world.manifestFile));
  const collected = { mods: [] as FactMod[], unreadable: [] as string[] };
  await readJars(world, collected);
  mergeManifest(collected.mods, manifest);
  mergeForgeList(collected.mods, level);
  return { world, level, manifest, mods: collected.mods, unreadableJars: collected.unreadable };
}

export const toModDto = (mod: FactMod): DetectedModDto => {
  const { path: _path, minecraft: _minecraft, ...dto } = mod;
  void _path;
  void _minecraft;
  return dto;
};

export function isModded(facts: Pick<ImportFacts, 'level' | 'mods' | 'manifest'>): boolean {
  const { level } = facts;
  return level.forgeMods.length > 0 || facts.mods.some((mod) => mod.dir === 'mods' && !isBuiltInModId(mod.modId ?? '')) || level.wasModded === true;
}

export function buildAnalysis(
  facts: ImportFacts,
  archive: ImportAnalysisDto['archive'],
  proposal: { loader: Loader; loaderVersion: string | null; mcVersion: string | null; evidence: string[] },
  notices: ImportNotice[],
): ImportAnalysisDto {
  const { world, level, manifest } = facts;
  return {
    archive,
    source: world.kind,
    world: {
      folderName: world.worldName,
      levelName: level.levelName,
      layout: world.layout,
      hasNether: world.netherSrc !== null,
      hasEnd: world.endSrc !== null,
      otherWorlds: world.otherWorlds,
      gameType: level.gameType,
      hardcore: level.hardcore,
      lastPlayed: level.lastPlayed,
      singleplayerPlayer: level.playerUuid !== null,
    },
    version: { mcVersion: level.mcVersion, approximate: level.mcVersionApprox, dataVersion: level.dataVersion, preOneNine: level.preOneNine },
    proposal,
    modded: isModded(facts),
    config: { properties: world.propertiesFile !== null, items: world.configItems },
    mods: facts.mods.map(toModDto),
    hasJars: facts.mods.some((mod) => mod.origin === 'jar'),
    manifest:
      manifest === null
        ? null
        : { appVersion: manifest.appVersion, createdAt: manifest.createdAt, mcVersion: manifest.server.mcVersion, loader: manifest.server.loader, loaderVersion: manifest.server.loaderVersion },
    notices,
  };
}
