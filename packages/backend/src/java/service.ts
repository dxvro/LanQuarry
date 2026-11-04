import path from 'node:path';
import type { Loader } from '../db/enums.js';
import { AppError } from '../http/errors.js';
import { JavaDetector } from './detect.js';
import { chooseRuntime, javaRequirement, meetsRequirement, type JavaRuntime } from './select.js';

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

interface Range {
  min: number;
  max: number | null;
}

export class JavaService {
  constructor(private readonly detector: JavaDetector = new JavaDetector()) {}

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

  async select(needs: JavaNeeds): Promise<JavaSelection> {
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
      return { runtime, warnings };
    }
    const runtimes = await this.detector.detect();
    if (runtimes.length === 0) {
      throw new AppError(
        422,
        'JAVA_NOT_FOUND',
        `Es wurde keine Java-Installation gefunden. Benötigt wird Java ${this.describe(requirement)}. Bitte Java installieren oder im Server den Java-Pfad angeben.`,
        { required: requirement.min, requiredMax: requirement.max, found: [] },
      );
    }
    const runtime = chooseRuntime(runtimes, requirement);
    if (runtime === null) {
      throw this.incompatible(
        requirement,
        runtimes.map((entry) => entry.major),
      );
    }
    return { runtime, warnings };
  }

  private describe({ min, max }: Range): string {
    if (max === null) return `${min} oder neuer`;
    return min === max ? `${min}` : `${min} bis ${max}`;
  }

  private incompatible(range: Range, found: number[]): AppError {
    return new AppError(
      422,
      'JAVA_VERSION_INCOMPATIBLE',
      `Dieser Server benötigt Java ${this.describe(range)}, gefunden wurde Java ${[...new Set(found)].join(', ')}.`,
      { required: range.min, requiredMax: range.max, found },
    );
  }
}
