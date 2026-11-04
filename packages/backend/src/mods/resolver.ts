import type { DependencyType } from '../db/enums.js';
import type { Mod } from '../db/schema.js';
import { AppError } from '../http/errors.js';
import type { ModrinthApi, Version, VersionFile } from '../modrinth/types.js';
import type { LoaderProfile } from './profile.js';
import { chooseNewest, isCompatible, pickFile } from './versions.js';

export const MAX_PLAN_SIZE = 64;
const KNOWN_TYPES: readonly string[] = ['required', 'optional', 'incompatible', 'embedded'];

export interface InstalledIncompatibility {
  modId: string;
  modName: string;
  projectId: string;
}

export interface ResolverContext {
  modrinth: ModrinthApi;
  profile: LoaderProfile;
  mcVersion: string;
  installed: readonly Mod[];
  installedIncompatibilities: readonly InstalledIncompatibility[];
  maxPlanSize?: number;
}

export interface PlannedDependency {
  type: DependencyType;
  projectId: string | null;
  versionId: string | null;
  fileName: string | null;
  linkProjectId: string | null;
}

export interface PlanItem {
  projectId: string;
  version: Version;
  file: VersionFile;
  isDependency: boolean;
  dependencies: PlannedDependency[];
}

export interface InstallPlan {
  items: PlanItem[];
  warnings: string[];
  names: Map<string, string>;
}

export type InstallDecision = { kind: 'flip'; mod: Mod } | { kind: 'install'; plan: InstallPlan };

interface IncompatibleEdge {
  fromProjectId: string;
  targetProjectId: string;
}

class PlanBuilder {
  private readonly planned = new Map<string, PlanItem>();
  private readonly versionCache = new Map<string, Version>();
  private readonly names = new Map<string, string>();
  private readonly installedByProject = new Map<string, Mod>();
  private readonly installedFiles = new Set<string>();
  private readonly edges: IncompatibleEdge[] = [];
  private readonly incompatibilities: readonly InstalledIncompatibility[];
  private readonly maxSize: number;
  readonly warnings: string[] = [];

  constructor(
    private readonly ctx: ResolverContext,
    replacingModId: string | null,
  ) {
    for (const mod of ctx.installed) {
      if (mod.id === replacingModId) continue;
      this.installedFiles.add(mod.fileName.toLowerCase());
      if (mod.projectId !== null) {
        this.installedByProject.set(mod.projectId, mod);
        this.names.set(mod.projectId, mod.name);
      }
    }
    this.incompatibilities = ctx.installedIncompatibilities.filter((entry) => entry.modId !== replacingModId);
    this.maxSize = ctx.maxPlanSize ?? MAX_PLAN_SIZE;
  }

  async version(id: string): Promise<Version | null> {
    const cached = this.versionCache.get(id);
    if (cached !== undefined) return cached;
    try {
      const version = await this.ctx.modrinth.getVersion(id);
      this.versionCache.set(id, version);
      return version;
    } catch (error) {
      if (error instanceof AppError && error.code === 'MOD_NOT_FOUND') return null;
      throw error;
    }
  }

  async newestFor(projectId: string, minRank = 0): Promise<Version | null> {
    const versions = await this.ctx.modrinth.listProjectVersions(projectId, this.ctx.profile.loaders, [this.ctx.mcVersion]);
    for (const version of versions) this.versionCache.set(version.id, version);
    return chooseNewest(versions, this.ctx.profile, this.ctx.mcVersion, minRank);
  }

  async addRoot(version: Version, isDependency: boolean): Promise<void> {
    await this.add(version, isDependency, [version.project_id]);
  }

  private async add(version: Version, isDependency: boolean, chain: string[]): Promise<void> {
    if (this.planned.size >= this.maxSize) {
      throw new AppError(422, 'PLAN_TOO_LARGE', `Die Abhängigkeiten umfassen mehr als ${this.maxSize} Mods. Die Installation wurde abgebrochen.`);
    }
    const file = pickFile(version);
    if (file === null) {
      throw new AppError(422, 'DEPENDENCY_UNRESOLVABLE', 'Die Version enthält keine herunterladbare .jar-Datei.');
    }
    const item: PlanItem = { projectId: version.project_id, version, file, isDependency, dependencies: [] };
    this.planned.set(version.project_id, item);

    for (const dep of version.dependencies) {
      if (!KNOWN_TYPES.includes(dep.dependency_type)) continue;
      const type = dep.dependency_type as DependencyType;
      const entry: PlannedDependency = {
        type,
        projectId: dep.project_id ?? null,
        versionId: dep.version_id ?? null,
        fileName: dep.file_name ?? null,
        linkProjectId: dep.project_id ?? null,
      };
      item.dependencies.push(entry);
      if (type === 'incompatible' && entry.projectId !== null) {
        this.edges.push({ fromProjectId: version.project_id, targetProjectId: entry.projectId });
      } else if (type === 'required') {
        entry.linkProjectId = await this.resolveRequired(dep, version, chain);
      }
    }
  }

  private async resolveRequired(
    dep: Version['dependencies'][number],
    parent: Version,
    chain: string[],
  ): Promise<string | null> {
    let pinned: Version | null = null;
    let projectId = dep.project_id ?? null;
    if (projectId === null && dep.version_id != null) {
      pinned = await this.version(dep.version_id);
      projectId = pinned?.project_id ?? null;
    }
    if (projectId === null) {
      const fileName = dep.file_name?.toLowerCase();
      const present = fileName !== undefined && (this.installedFiles.has(fileName) || this.plannedFile(fileName));
      if (!present) {
        this.warnings.push(
          `Die Abhängigkeit „${dep.file_name ?? 'unbekannt'}“ von „${parent.name}“ liegt außerhalb von Modrinth und muss manuell bereitgestellt werden.`,
        );
      }
      return null;
    }

    const planned = this.planned.get(projectId);
    if (planned !== undefined) {
      if (dep.version_id != null && dep.version_id !== planned.version.id) {
        this.warnings.push(
          `Abhängigkeit von „${parent.name}“ fordert eine andere Version von „${planned.version.name}“; die bereits gewählte Version wird verwendet.`,
        );
      }
      return projectId;
    }
    if (this.installedByProject.has(projectId)) return projectId;

    let target: Version | null = null;
    if (dep.version_id != null) {
      pinned ??= await this.version(dep.version_id);
      if (pinned !== null && pinned.project_id === projectId && isCompatible(pinned, this.ctx.profile, this.ctx.mcVersion)) {
        target = pinned;
      }
    }
    target ??= await this.newestFor(projectId);
    if (target === null) {
      const names = await this.titles([...chain, projectId]);
      throw new AppError(
        422,
        'DEPENDENCY_UNRESOLVABLE',
        `Für die benötigte Abhängigkeit „${names[names.length - 1]}“ gibt es keine Version für Minecraft ${this.ctx.mcVersion} mit ${this.ctx.profile.loaders.join('/')} (${names.join(' -> ')}).`,
        { chain: names, projectId },
      );
    }
    await this.add(target, true, [...chain, projectId]);
    return projectId;
  }

  private plannedFile(lowerName: string): boolean {
    return [...this.planned.values()].some((item) => item.file.filename.toLowerCase() === lowerName);
  }

  private async titles(projectIds: readonly string[]): Promise<string[]> {
    const missing = projectIds.filter((id) => !this.names.has(id));
    if (missing.length > 0) {
      try {
        for (const project of await this.ctx.modrinth.getProjects(missing)) this.names.set(project.id, project.title);
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
      }
    }
    return projectIds.map((id) => this.names.get(id) ?? id);
  }

  async finish(): Promise<InstallPlan> {
    const ids = [...this.planned.keys()];
    await this.titles(ids);
    const name = (id: string): string => this.names.get(id) ?? id;

    for (const edge of this.edges) {
      const present = this.planned.has(edge.targetProjectId) || this.installedByProject.has(edge.targetProjectId);
      if (present && edge.targetProjectId !== edge.fromProjectId) {
        throw new AppError(
          409,
          'MOD_INCOMPATIBLE',
          `„${name(edge.fromProjectId)}“ ist nicht kompatibel mit „${name(edge.targetProjectId)}“.`,
          { mods: [name(edge.fromProjectId), name(edge.targetProjectId)] },
        );
      }
    }
    for (const entry of this.incompatibilities) {
      if (this.planned.has(entry.projectId)) {
        throw new AppError(
          409,
          'MOD_INCOMPATIBLE',
          `„${entry.modName}“ ist nicht kompatibel mit „${name(entry.projectId)}“.`,
          { mods: [entry.modName, name(entry.projectId)] },
        );
      }
    }
    return { items: [...this.planned.values()], warnings: this.warnings, names: this.names };
  }
}

export async function planInstall(
  ctx: ResolverContext,
  projectId: string,
  versionId: string | undefined,
): Promise<InstallDecision> {
  const builder = new PlanBuilder(ctx, null);
  let target: Version | null;
  if (versionId !== undefined) {
    target = await builder.version(versionId);
    if (target === null || target.project_id !== projectId) {
      throw new AppError(404, 'MOD_NOT_FOUND', 'Die angeforderte Version gehört nicht zu diesem Projekt oder existiert nicht.');
    }
    if (!isCompatible(target, ctx.profile, ctx.mcVersion)) {
      throw new AppError(
        422,
        'VERSION_INCOMPATIBLE',
        `Die gewählte Version ist nicht mit Minecraft ${ctx.mcVersion} und ${ctx.profile.loaders.join('/')} kompatibel.`,
      );
    }
  } else {
    target = await builder.newestFor(projectId);
    if (target === null) {
      throw new AppError(
        422,
        'NO_COMPATIBLE_VERSION',
        `Es gibt keine Version für Minecraft ${ctx.mcVersion} mit ${ctx.profile.loaders.join('/')}.`,
      );
    }
  }

  const existing = ctx.installed.find((mod) => mod.projectId === projectId);
  if (existing !== undefined) {
    if (existing.versionId !== target.id) {
      throw new AppError(
        409,
        'MOD_VERSION_DIFFERS',
        `„${existing.name}“ ist bereits in einer anderen Version installiert. Bitte die Update-Funktion verwenden.`,
      );
    }
    if (existing.isDependency) return { kind: 'flip', mod: existing };
    throw new AppError(409, 'MOD_ALREADY_INSTALLED', `„${existing.name}“ ist bereits installiert.`);
  }

  await builder.addRoot(target, false);
  return { kind: 'install', plan: await builder.finish() };
}

export async function planUpdate(ctx: ResolverContext, mod: Mod, target: Version): Promise<InstallPlan> {
  const builder = new PlanBuilder(ctx, mod.id);
  await builder.addRoot(target, mod.isDependency);
  return builder.finish();
}
