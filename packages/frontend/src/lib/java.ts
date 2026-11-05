import type { JavaRuntime, Loader } from './types';

function parseMc(version: string): number[] | null {
  const match = /^(\d+(?:\.\d+)*)/.exec(version);
  return match?.[1] === undefined ? null : match[1].split('.').map(Number);
}

const compare = (a: readonly number[], b: readonly number[]): number => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

// Rough Java major for a Minecraft version, only used to warn before the server exists. After creating, the
// backend reports the exact value from the Mojang version data (requiredJavaMajor).
export function estimateRequiredJava(mcVersion: string): number | null {
  const parts = parseMc(mcVersion);
  if (parts === null) return null;
  if ((parts[0] ?? 0) >= 26) return 25;
  if (compare(parts, [1, 20, 5]) >= 0) return 21;
  if (compare(parts, [1, 18]) >= 0) return 17;
  if (compare(parts, [1, 17]) >= 0) return 16;
  return 8;
}

export interface JavaFit {
  fits: boolean;
  requirement: string;
}

interface Requirement {
  requiredJavaMajor: number | null;
  loader: Loader;
  mcVersion: string;
}

// Same rule as the backend: at least the version Minecraft needs, and Forge up to 1.12.2 only runs on Java 8.
export function javaFit(runtime: Pick<JavaRuntime, 'major'>, server: Requirement): JavaFit {
  const min = server.requiredJavaMajor ?? 8;
  const parts = parseMc(server.mcVersion);
  const oldForge = server.loader === 'forge' && parts !== null && (parts[0] ?? 0) < 26 && compare(parts, [1, 12, 2]) <= 0;
  if (oldForge) return { fits: runtime.major <= 8 && runtime.major >= min, requirement: `Java ${min} bis 8` };
  return { fits: runtime.major >= min, requirement: `Java ${min} oder neuer` };
}
