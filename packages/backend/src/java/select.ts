import type { Loader } from '../db/enums.js';
import { mcAtMost } from '../installer/mc-version.js';

export interface JavaRuntime {
  path: string;
  major: number;
  version: string;
  name: string;
  source: 'JAVA_HOME' | 'PATH' | 'standard' | 'manual';
}

export interface JavaRequirement {
  min: number;
  max: number | null;
  note: string | null;
}

// Forge up to 1.12.2 (LaunchWrapper) cannot run on Java 9+. For 1.13-1.16.5 no hard limit could be
// verified, so that range only produces a warning
export function javaRequirement(loader: Loader, mcVersion: string, requiredMajor: number | null): JavaRequirement {
  const min = requiredMajor ?? 8;
  if (loader === 'forge' && mcAtMost(mcVersion, 1, 12, 2)) return { min, max: 8, note: null };
  if (loader === 'forge' && mcAtMost(mcVersion, 1, 16, 5)) {
    return { min, max: null, note: 'Forge für Minecraft bis 1.16.5 ist mit neueren Java-Versionen als 11 oft nicht lauffähig. Java 8 wird empfohlen.' };
  }
  return { min, max: null, note: null };
}

export const meetsRequirement = (major: number, requirement: JavaRequirement): boolean =>
  major >= requirement.min && (requirement.max === null || major <= requirement.max);

// lowest suitable major first: the closest match to what the server was built for
export function chooseRuntime(runtimes: readonly JavaRuntime[], requirement: JavaRequirement): JavaRuntime | null {
  const suitable = runtimes.filter((runtime) => meetsRequirement(runtime.major, requirement));
  return suitable.sort((a, b) => a.major - b.major || a.path.localeCompare(b.path))[0] ?? null;
}
