import path from 'node:path';
import type { Loader } from '../db/enums.js';
import { AppError } from '../http/errors.js';
import { JavaDetector } from './detect.js';
import type { EnsureOptions, JavaInstallEvent, ManagedRuntimeInfo, ManagedRuntimes } from './managed.js';
import {
  chooseRuntime,
  javaRequirement,
  meetsRequirement,
  pickInstallMajor,
  type JavaRequirement,
  type JavaRuntime,
} from './select.js';

export interface JavaSelection {
  runtime: JavaRuntime;
  warnings: string[];
}

export interface JavaNeeds {
  javaPath: string | null;
  loader: Loader;
  mcVersion: string;
  requiredMajor: number | null;
}

// What to do for a server: use a runtime that exists, or install this major first
export type JavaPlan = ({ kind: 'ready' } & JavaSelection) | { kind: 'install'; major: number; warnings: string[] };

interface Range {
  min: number;
  max: number | null;
}

export class JavaService {
  constructor(
    private readonly detector: JavaDetector = new JavaDetector(),
    private readonly managed: ManagedRuntimes | null = null,
    private readonly autoInstall = false,
  ) {}

  get autoInstallEnabled(): boolean {
    return this.autoInstall && this.managed !== null;
  }

  get canInstall(): boolean {
    return this.managed !== null;
  }

  detect(rescan = false): Promise<JavaRuntime[]> {
    return this.detector.detect(rescan);
  }

  // user-supplied path: must be a java executable that answers -version
  async validatePath(javaPath: string): Promise<JavaRuntime> {
    const base = path.basename(javaPath).toLowerCase();
    if (javaPath.trim() === '' || (base !== 'java' && base !== 'java.exe')) {
      throw new AppError(422, 'JAVA_INVALID', 'Der Java-Pfad muss auf eine Datei namens java bzw. java.exe zeigen.');
    }
    const runtime = await this.detector.inspect(javaPath, 'manual');
    if (runtime === null) {
      throw new AppError(
        422,
        'JAVA_INVALID',
        'Die angegebene Java-Datei konnte nicht ausgeführt werden oder ist keine gültige Java-Installation.',
      );
    }
    return runtime;
  }

  // Decides without installing anything. Errors are the classic JAVA_NOT_FOUND / JAVA_VERSION_INCOMPATIBLE
  // whenever a missing runtime may not (or cannot) be installed automatically.
  async plan(needs: JavaNeeds): Promise<JavaPlan> {
    const requirement = javaRequirement(needs.loader, needs.mcVersion, needs.requiredMajor);
    const warnings = requirement.note === null ? [] : [requirement.note];
    if (needs.javaPath !== null) {
      const runtime = await this.detector.inspect(needs.javaPath, 'manual');
      if (runtime === null) {
        throw new AppError(
          422,
          'JAVA_NOT_FOUND',
          `Die eingestellte Java-Installation wurde nicht gefunden oder startet nicht: ${needs.javaPath}`,
          { javaPath: needs.javaPath },
        );
      }
      if (!meetsRequirement(runtime.major, requirement)) throw this.incompatible(requirement, [runtime.major]);
      return { kind: 'ready', runtime, warnings };
    }
    const runtimes = await this.detector.detect();
    const runtime = chooseRuntime(runtimes, requirement);
    if (runtime !== null) return { kind: 'ready', runtime, warnings };
    const major = this.autoInstallEnabled ? pickInstallMajor(requirement) : null;
    if (major !== null) return { kind: 'install', major, warnings };
    if (runtimes.length === 0) {
      throw new AppError(
        422,
        'JAVA_NOT_FOUND',
        `Es wurde keine Java-Installation gefunden. Benötigt wird Java ${this.describe(requirement)}. Bitte Java installieren oder im Server den Java-Pfad angeben.`,
        { required: requirement.min, requiredMax: requirement.max, found: [] },
      );
    }
    throw this.incompatible(
      requirement,
      runtimes.map((entry) => entry.major),
    );
  }

  // Never installs: for callers that cannot wait for a download
  async select(needs: JavaNeeds): Promise<JavaSelection> {
    const plan = await this.plan(needs);
    if (plan.kind === 'ready') return { runtime: plan.runtime, warnings: plan.warnings };
    throw new AppError(422, 'JAVA_NOT_FOUND', `Java ${plan.major} ist nicht installiert.`, { required: plan.major });
  }

  // Selects a runtime and installs the missing one first (shared per major, progress via options)
  async acquire(needs: JavaNeeds, options: EnsureOptions = {}): Promise<JavaSelection> {
    const plan = await this.plan(needs);
    if (plan.kind === 'ready') return { runtime: plan.runtime, warnings: plan.warnings };
    await this.ensureManaged(plan.major, options);
    const selection = await this.select(needs);
    return { runtime: selection.runtime, warnings: plan.warnings };
  }

  private requireManaged(): ManagedRuntimes {
    if (this.managed === null) {
      throw new AppError(409, 'JAVA_INSTALL_UNAVAILABLE', 'Die automatische Java-Installation ist in dieser Konfiguration nicht verfügbar.');
    }
    return this.managed;
  }

  async ensureManaged(major: number, options: EnsureOptions = {}): Promise<JavaRuntime> {
    const managed = this.requireManaged();
    const info = await managed.ensure(major, options);
    await this.detector.detect(true);
    return managed.toRuntime(info);
  }

  onInstallEvent(listener: (event: JavaInstallEvent) => void): () => void {
    return this.managed === null ? () => undefined : this.managed.onEvent(listener);
  }

  // boot: removes what an interrupted install left behind
  cleanup(): Promise<number> {
    return this.managed === null ? Promise.resolve(0) : this.managed.cleanup();
  }

  shutdown(): void {
    this.managed?.shutdown();
  }

  listManaged(): Promise<ManagedRuntimeInfo[]> {
    return this.managed === null ? Promise.resolve([]) : this.managed.list();
  }

  activeInstalls(): Array<{ major: number; phase: string | null; percent: number | null; message: string | null }> {
    return (this.managed?.activeInstalls() ?? []).map((entry) => ({
      major: entry.major,
      phase: entry.progress?.phase ?? null,
      percent: entry.progress?.percent ?? null,
      message: entry.progress?.message ?? null,
    }));
  }

  async removeManaged(major: number): Promise<void> {
    await this.requireManaged().remove(major);
    await this.detector.detect(true);
  }

  private describe({ min, max }: Range): string {
    if (max === null) return `${min} oder neuer`;
    return min === max ? `${min}` : `${min} bis ${max}`;
  }

  private incompatible(range: JavaRequirement, found: number[]): AppError {
    return new AppError(
      422,
      'JAVA_VERSION_INCOMPATIBLE',
      `Dieser Server benötigt Java ${this.describe(range)}, gefunden wurde Java ${[...new Set(found)].join(', ')}.`,
      { required: range.min, requiredMax: range.max, found },
    );
  }
}
