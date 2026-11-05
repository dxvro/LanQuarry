import { eq, inArray } from 'drizzle-orm';
import { access } from 'node:fs/promises';
import path from 'node:path';
import type { ToggleResult } from '../contract.js';
import type { Db } from '../db/client.js';
import { mods, type Mod } from '../db/schema.js';
import { AppError } from '../http/errors.js';
import { DISABLED_SUFFIX } from './files.js';
import { incompatibleRows, requiredBy, requiredLinks } from './graph.js';
import { contentDirOf, moveAll, planEnableMoves, undoMoves, type FileMove, type InstallEnv } from './installer.js';

export type { ToggleResult };

export interface ToggleEnv extends InstallEnv {
  db: Db;
}

async function requireMod(env: ToggleEnv, modId: string): Promise<Mod> {
  const mod = (await env.db.select().from(mods).where(eq(mods.id, modId)))[0];
  if (mod === undefined || mod.serverId !== env.serverId) throw new AppError(404, 'MOD_NOT_FOUND', 'Der Mod wurde nicht gefunden.');
  return mod;
}

// the mod and, recursively, every switched-off mod it requires
async function enableClosure(env: ToggleEnv, mod: Mod): Promise<Mod[]> {
  const all = await env.db.select().from(mods).where(eq(mods.serverId, env.serverId));
  const byId = new Map(all.map((entry) => [entry.id, entry]));
  const links = await requiredLinks(env.db, env.serverId);
  const closure: Mod[] = [];
  const seen = new Set<string>();
  const visit = (current: Mod): void => {
    if (seen.has(current.id)) return;
    seen.add(current.id);
    if (!current.enabled) closure.push(current);
    for (const id of links.get(current.id) ?? []) {
      const dependency = byId.get(id);
      if (dependency !== undefined) visit(dependency);
    }
  };
  visit(mod);
  return closure;
}

// Enabling must not bring two mods together that declare each other incompatible
async function assertNoConflict(env: ToggleEnv, toEnable: readonly Mod[]): Promise<void> {
  const all = await env.db.select().from(mods).where(eq(mods.serverId, env.serverId));
  const switchedOn = new Set(toEnable.map((mod) => mod.id));
  const active = all.filter((mod) => mod.enabled || switchedOn.has(mod.id));
  const byProject = new Map<string, Mod>();
  for (const mod of active) if (mod.projectId !== null) byProject.set(mod.projectId, mod);
  const activeIds = new Set(active.map((mod) => mod.id));
  const byId = new Map(all.map((mod) => [mod.id, mod]));
  for (const row of await incompatibleRows(env.db, env.serverId)) {
    const owner = byId.get(row.modId);
    const target = byProject.get(row.projectId);
    if (owner === undefined || target === undefined || owner.id === target.id || !activeIds.has(owner.id)) continue;
    if (!switchedOn.has(owner.id) && !switchedOn.has(target.id)) continue;
    throw new AppError(409, 'MOD_INCOMPATIBLE', `„${owner.name}“ ist nicht kompatibel mit „${target.name}“.`, { mods: [owner.name, target.name] });
  }
}

async function setFlag(db: Db, ids: readonly string[], enabled: boolean): Promise<void> {
  await db.transaction((tx) => tx.update(mods).set({ enabled, updatedAt: new Date() }).where(inArray(mods.id, [...ids])));
}

export async function setModEnabled(env: ToggleEnv, modId: string, enabled: boolean, force: boolean): Promise<ToggleResult> {
  const mod = await requireMod(env, modId);
  if (mod.enabled === enabled) return { mod, changed: [], dependencies: [], warnings: [] };
  const dir = contentDirOf(env);
  const warnings: string[] = [];
  let affected: Mod[];
  let moves: FileMove[];

  if (enabled) {
    affected = await enableClosure(env, mod);
    await assertNoConflict(env, affected);
    moves = await planEnableMoves(env, affected);
    for (const dependency of affected.filter((entry) => entry.id !== mod.id)) {
      warnings.push(`„${dependency.name}“ war deaktiviert und wurde als benötigte Abhängigkeit ebenfalls aktiviert.`);
    }
  } else {
    const dependents = await requiredBy(env.db, mod.id, true);
    if (dependents.length > 0 && !force) {
      throw new AppError(
        409,
        'MOD_REQUIRED_BY_OTHERS',
        `„${mod.name}“ wird von anderen Mods benötigt: ${dependents.map((entry) => entry.name).join(', ')}.`,
        { dependents: dependents.map((entry) => ({ id: entry.id, name: entry.name })) },
      );
    }
    if (dependents.length > 0) {
      warnings.push(`„${mod.name}“ wird trotzdem deaktiviert, obwohl es von ${dependents.map((entry) => `„${entry.name}“`).join(', ')} benötigt wird.`);
    }
    affected = [mod];
    const from = path.join(dir, mod.fileName);
    const to = `${from}${DISABLED_SUFFIX}`;
    moves = [{ from, to }];
    await assertDisableMove(from, to, mod);
  }

  const moved: FileMove[] = [];
  await moveAll(moves, moved);
  try {
    await setFlag(env.db, affected.map((entry) => entry.id), enabled);
  } catch (error) {
    await undoMoves(moved);
    throw error;
  }
  const changed = affected.map((entry) => ({ ...entry, enabled }));
  return {
    mod: { ...mod, enabled },
    changed,
    dependencies: changed.filter((entry) => entry.id !== mod.id),
    warnings,
  };
}

const exists = (file: string): Promise<boolean> =>
  access(file).then(
    () => true,
    () => false,
  );

async function assertDisableMove(from: string, to: string, mod: Mod): Promise<void> {
  if (!(await exists(from))) {
    throw new AppError(409, 'MOD_FILE_MISSING', `Die Datei „${mod.fileName}“ von „${mod.name}“ fehlt. Bitte die Mod-Liste neu einlesen.`, { modId: mod.id });
  }
  if (await exists(to)) {
    throw new AppError(409, 'FILE_EXISTS', `Die Datei „${mod.fileName}${DISABLED_SUFFIX}“ existiert bereits im Serverordner, „${mod.name}“ kann nicht deaktiviert werden.`);
  }
}
