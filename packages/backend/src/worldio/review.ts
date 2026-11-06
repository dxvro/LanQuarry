import type { Loader } from '../db/enums.js';
import { LOADER_INFO } from '../installer/catalog.js';
import { mcAtMost } from '../installer/mc-version.js';
import { AppError } from '../http/errors.js';
import { mapLimit } from '../mods/files.js';
import { getLoaderProfile } from '../mods/profile.js';
import { chooseNewest } from '../mods/versions.js';
import type { ModrinthApi, Project, Version } from '../modrinth/types.js';
import { isBuiltInModId, type FactMod, type ImportFacts } from './analyze.js';
import { compareWorldToTarget, seriesOf } from './data-versions.js';
import type { ImportNotice, ModCandidateDto, ModMatchDto } from './dto.js';
import { styleForLoader } from './layout.js';

export interface ReviewTarget {
  loader: Loader;
  mcVersion: string;
}

const LOADER_NAME: Record<Loader, string> = { vanilla: 'Vanilla', fabric: 'Fabric', paper: 'Paper', forge: 'Forge', neoforge: 'NeoForge' };
const MODDED_FAMILY = new Set<Loader>(['fabric', 'forge', 'neoforge']);
const MAX_LOOKUPS = 80;
const LOOKUP_CONCURRENCY = 3;
const list = (names: readonly string[], max = 8): string => (names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} und ${names.length - max} weitere`);

const notice = (code: string, level: ImportNotice['level'], text: string, needsConfirm = false): ImportNotice => ({ code, level, text, needsConfirm });

// the platform a jar was built for, as the loader of the server it can run on
function jarLoaders(mod: FactMod): Loader[] {
  const out = new Set<Loader>();
  for (const loader of mod.loaders) out.add(loader === 'quilt' ? 'fabric' : loader);
  return [...out];
}

export function detectedFamily(facts: ImportFacts, proposed: Loader): Loader | null {
  return MODDED_FAMILY.has(proposed) ? proposed : null;
}

// Everything worth telling the user about carrying this world to `target`. Errors block the import.
export function evaluateNotices(facts: ImportFacts, target: ReviewTarget, proposedLoader: Loader, mode: 'new' | 'replace', modded: boolean): ImportNotice[] {
  const { level, world } = facts;
  const out: ImportNotice[] = [];

  if (level.preOneNine && !mcAtMost(target.mcVersion, 1, 8)) {
    out.push(
      notice(
        'WORLD_PRE_1_9',
        'warn',
        'Diese Welt ist älter als Minecraft 1.9 (level.dat enthält keine Versionsangabe). Bitte die passende Minecraft-Version selbst wählen. Beim ersten Start wird die Welt auf das gewählte Format umgestellt, das lässt sich nicht rückgängig machen.',
        true,
      ),
    );
  } else if (!level.preOneNine) {
    const order = compareWorldToTarget({ name: level.mcVersion, dataVersion: level.dataVersion }, target.mcVersion);
    const worldLabel = level.mcVersion === null ? 'unbekannter Version' : `Minecraft ${level.mcVersion}${level.mcVersionApprox ? ' (geschätzt)' : ''}`;
    if (order === 'newer') {
      out.push(
        notice(
          'WORLD_NEWER',
          'error',
          `Die Welt wurde zuletzt mit ${worldLabel} gespeichert und ist damit neuer als die gewählte Version ${target.mcVersion}. Eine Welt auf eine ältere Version zurückzusetzen beschädigt sie. Bitte mindestens ${level.mcVersion ?? 'die Version der Welt'} wählen.`,
        ),
      );
    } else if (order === 'older') {
      const worldSeries = level.mcVersion === null ? null : seriesOf(level.mcVersion);
      if (worldSeries !== seriesOf(target.mcVersion)) {
        out.push(
          notice(
            'WORLD_UPGRADE',
            'warn',
            `Die Welt stammt aus ${worldLabel} und wird beim ersten Start auf ${target.mcVersion} umgestellt. Das geht nur in eine Richtung: danach lässt sie sich nicht mehr mit der alten Version öffnen. Vorher ein Backup der Quelle aufheben.`,
            true,
          ),
        );
      } else {
        out.push(notice('WORLD_PATCH_UPGRADE', 'info', `Die Welt stammt aus ${worldLabel} und wird beim Start auf ${target.mcVersion} aktualisiert.`));
      }
    } else if (order === 'unknown') {
      out.push(
        notice('WORLD_VERSION_UNKNOWN', 'warn', 'Die Minecraft-Version der Welt konnte nicht bestimmt werden. Wird eine zu alte Version gewählt, kann die Welt beschädigt werden.', true),
      );
    }
  }

  if (modded && !LOADER_INFO[target.loader].supportsMods) {
    out.push(
      notice('MODDED_NO_LOADER', 'warn', `Die Welt enthält Inhalte von Mods, ${LOADER_NAME[target.loader]} kann sie aber nicht laden. Modifizierte Blöcke, Gegenstände und Wesen gehen verloren.`, true),
    );
  } else if (modded && target.loader === 'paper') {
    out.push(
      notice('MODDED_PAPER', 'warn', 'Paper lädt keine Mods, nur Plugins. Modifizierte Blöcke, Gegenstände und Wesen der Welt gehen verloren.', true),
    );
  }
  const family = detectedFamily(facts, proposedLoader);
  if (modded && family !== null && MODDED_FAMILY.has(target.loader) && family !== target.loader) {
    out.push(
      notice(
        'LOADER_SWITCH',
        'warn',
        `Die Welt gehört zu ${LOADER_NAME[family]}, gewählt ist ${LOADER_NAME[target.loader]}. Mods sind zwischen Mod-Loadern nicht austauschbar; Inhalte der Mods können verloren gehen oder die Welt lässt sich nicht laden.`,
        true,
      ),
    );
  }

  const style = styleForLoader(target.loader);
  if (world.layout !== 'unified' && (world.netherSrc !== null || world.endSrc !== null) && world.layout !== style) {
    out.push(
      notice(
        'LAYOUT_CONVERTED',
        'info',
        style === 'split'
          ? 'Nether und End werden für Paper in eigene Ordner (_nether, _the_end) verschoben.'
          : 'Nether und End werden aus den Paper-Ordnern in den Weltordner (DIM-1, DIM1) verschoben.',
      ),
    );
  }
  if (world.layout === 'unified' && style === 'split') {
    out.push(notice('LAYOUT_UNIFIED', 'info', 'Die Welt verwendet das neue Ordnerformat mit „dimensions“ und wird unverändert übernommen.'));
  }
  if (world.otherWorlds.length > 0) {
    out.push(notice('OTHER_WORLDS', 'info', `Im Archiv liegen weitere Welten, die nicht übernommen werden: ${list(world.otherWorlds)}.`));
  }
  if (level.playerUuid !== null && mode === 'new') {
    out.push(notice('SINGLEPLAYER_PLAYER', 'info', 'Der Spielstand des Einzelspielers (Inventar, Position) wird für den Server übernommen. Er gilt für den Spieler mit derselben Mojang-Konto-ID, der Server sollte im Online-Modus laufen.'));
  }
  if (mode === 'replace') {
    out.push(notice('REPLACE_ONE_WAY', 'info', 'Die jetzige Welt wird durch die importierte ersetzt. Vorher wird automatisch ein Sicherheits-Backup angelegt.'));
  }
  return out;
}

// ---- matching mods against Modrinth ---------------------------------------------------------

const normalise = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

interface MatchContext {
  modrinth: ModrinthApi;
  target: ReviewTarget;
}

export interface ReviewMatches {
  matches: ModMatchDto[];
  modrinthAvailable: boolean;
}

const emptyMatch = (key: string): ModMatchDto => ({
  key,
  state: 'not-found',
  projectId: null,
  projectTitle: null,
  versionId: null,
  versionNumber: null,
  candidates: [],
  selected: false,
});

export async function matchMods(facts: ImportFacts, context: MatchContext): Promise<ReviewMatches> {
  const profile = getLoaderProfile(context.target.loader);
  const matches = new Map<string, ModMatchDto>();
  let available = true;
  const visible = facts.mods.filter((mod) => !(mod.modId !== null && isBuiltInModId(mod.modId)));
  if (profile === null) {
    for (const mod of visible) matches.set(mod.key, emptyMatch(mod.key));
    return { matches: visible.map((mod) => matches.get(mod.key) as ModMatchDto), modrinthAvailable: true };
  }
  const accepted = new Set<string>(profile.loaders);
  for (const mod of visible) {
    const base = emptyMatch(mod.key);
    matches.set(mod.key, base);
    if (mod.side === 'client') {
      base.state = 'client-only';
      continue;
    }
    if (mod.origin === 'jar') {
      const loaders = jarLoaders(mod);
      if (loaders.length > 0 && !loaders.some((loader) => accepted.has(loader))) base.state = 'wrong-loader';
      else {
        base.state = 'jar';
        base.selected = true;
      }
    }
  }

  const titles = new Map<string, Project>();
  const projectOf = async (id: string): Promise<Project | null> => {
    const cached = titles.get(id);
    if (cached !== undefined) return cached;
    try {
      const project = await context.modrinth.getProject(id);
      titles.set(project.id, project);
      titles.set(id, project);
      return project;
    } catch (error) {
      if (error instanceof AppError && error.code === 'MOD_NOT_FOUND') return null;
      throw error;
    }
  };
  const versionFor = async (projectId: string, exact: Version | null): Promise<Version | null> => {
    if (exact !== null && exact.game_versions.includes(context.target.mcVersion) && exact.loaders.some((loader) => accepted.has(loader))) return exact;
    const versions = await context.modrinth.listProjectVersions(projectId, profile.loaders, [context.target.mcVersion]);
    return chooseNewest(versions, profile, context.target.mcVersion);
  };

  try {
    // 1. hashes: jars become "known" (updatable), files named only in the export find their project
    const hashed = visible.filter((mod) => mod.sha512 !== null);
    const found = hashed.length === 0 ? {} : await context.modrinth.versionFilesByHash(hashed.map((mod) => mod.sha512 as string));
    const exact = new Map<string, Version>();
    for (const mod of hashed) {
      const version = found[mod.sha512 as string];
      if (version !== undefined) exact.set(mod.key, version);
    }
    if (exact.size > 0) {
      for (const project of await context.modrinth.getProjects([...new Set([...exact.values()].map((v) => v.project_id))])) titles.set(project.id, project);
    }
    for (const mod of visible) {
      const match = matches.get(mod.key) as ModMatchDto;
      const version = exact.get(mod.key);
      if (match.state === 'client-only' || match.state === 'wrong-loader') continue;
      if (version === undefined) continue;
      const project = titles.get(version.project_id);
      match.projectId = version.project_id;
      match.projectTitle = project?.title ?? mod.name;
      if (mod.origin === 'jar') {
        match.state = 'jar-known';
        match.versionId = version.id;
        match.versionNumber = version.version_number;
      }
    }

    // 2. mods without a jar: by project id of the export, by slug, by search
    const pending = visible.filter((mod) => (matches.get(mod.key) as ModMatchDto).state === 'not-found').slice(0, MAX_LOOKUPS);
    const skipped = visible.filter((mod) => (matches.get(mod.key) as ModMatchDto).state === 'not-found').length - pending.length;
    void skipped;
    await mapLimit(pending, LOOKUP_CONCURRENCY, async (mod) => {
      const match = matches.get(mod.key) as ModMatchDto;
      let project: Project | null = null;
      const knownProject = match.projectId ?? mod.projectId;
      if (knownProject !== null) project = await projectOf(knownProject);
      if (project === null) {
        for (const slug of [mod.modId, mod.name].flatMap((text) => (text === null ? [] : [normalise(text)])).filter((text, i, all) => text !== '' && all.indexOf(text) === i)) {
          project = await projectOf(slug);
          if (project !== null) break;
        }
      }
      if (project !== null && !['mod', 'plugin'].includes(project.project_type)) project = null;
      if (project === null) {
        const query = mod.modId ?? mod.name;
        const result = await context.modrinth.search({
          query,
          facets: [[`project_type:${profile.projectType}`], [`versions:${context.target.mcVersion}`], profile.loaders.map((loader) => `categories:${loader}`)],
          index: 'relevance',
          limit: 3,
          offset: 0,
        });
        const candidates: ModCandidateDto[] = result.hits.map((hit) => ({ projectId: hit.project_id, slug: hit.slug, title: hit.title }));
        if (candidates.length > 0) {
          match.state = 'ambiguous';
          match.candidates = candidates;
        }
        return;
      }
      match.projectId = project.id;
      match.projectTitle = project.title;
      const version = await versionFor(project.id, exact.get(mod.key) ?? null);
      if (version === null) {
        match.state = 'incompatible';
        return;
      }
      match.state = 'found';
      match.versionId = version.id;
      match.versionNumber = version.version_number;
      match.selected = true;
    });
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    available = false;
  }
  return { matches: visible.map((mod) => matches.get(mod.key) as ModMatchDto), modrinthAvailable: available };
}

export interface ModSelection {
  jars: string[];
  install: Array<{ key: string; projectId: string; versionId?: string | undefined }>;
}

// Mods the world needs (server side) that neither a jar nor a Modrinth install of the selection provides
export function missingMods(facts: ImportFacts, selection: ModSelection): FactMod[] {
  const covered = new Set<string>([...selection.jars, ...selection.install.map((entry) => entry.key)]);
  return facts.mods.filter((mod) => !covered.has(mod.key) && mod.side !== 'client' && !(mod.modId !== null && isBuiltInModId(mod.modId)) && mod.dir === 'mods');
}

export function missingNotice(missing: readonly FactMod[]): ImportNotice | null {
  if (missing.length === 0) return null;
  return notice(
    'MODS_MISSING',
    'warn',
    `Diese Mods der Welt werden nicht bereitgestellt: ${list(missing.map((mod) => mod.name))}. Startet der Server ohne sie, können Blöcke und Gegenstände der Mods aus der Welt verschwinden.`,
    true,
  );
}
