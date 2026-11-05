import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { parseHostHeader } from '../http/host.js';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

// src/config and dist/config share the same depth: <repo>/packages/backend/<src|dist>/config
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

const nonEmpty = (value: unknown): unknown => (value === '' ? undefined : value);

const envSchema = z.object({
  HOST: z.preprocess(nonEmpty, z.string().min(1).default('0.0.0.0')),
  PORT: z.preprocess(nonEmpty, z.coerce.number().int().min(1).max(65535).default(3000)),
  DATA_DIR: z.preprocess(nonEmpty, z.string().min(1).default(path.join(REPO_ROOT, 'data'))),
  SERVERS_DIR: z.preprocess(nonEmpty, z.string().min(1).default(path.join(REPO_ROOT, 'servers'))),
  FRONTEND_DIR: z.preprocess(nonEmpty, z.string().min(1).default(path.join('packages', 'frontend', 'dist'))),
  LOG_LEVEL: z.preprocess(nonEmpty, z.enum(LOG_LEVELS).default('info')),
  MODRINTH_USER_AGENT: z.preprocess(nonEmpty, z.string().min(3).max(200).optional()),
  AUTH_TOKEN: z.preprocess(nonEmpty, z.string().min(8, 'mindestens 8 Zeichen').max(200).optional()),
  ALLOWED_ORIGINS: z.preprocess(nonEmpty, z.string().optional()),
  ALLOWED_HOSTS: z.preprocess(nonEmpty, z.string().optional()),
  STOP_TIMEOUT_SECONDS: z.preprocess(nonEmpty, z.coerce.number().int().min(5).max(3600).default(120)),
});

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  serversDir: string;
  // built frontend; undefined disables static serving (the API-only embedder case)
  frontendDir?: string;
  logLevel: (typeof LOG_LEVELS)[number];
  modrinthUserAgent?: string;
  authToken?: string;
  allowedOrigins: string[];
  allowedHosts: string[];
  stopTimeoutMs: number;
}

export class ConfigError extends Error {}

function parseOrigins(raw: string | undefined): string[] {
  const origins: string[] = [];
  for (const entry of (raw ?? '').split(',')) {
    const trimmed = entry.trim();
    if (trimmed === '') continue;
    try {
      origins.push(new URL(trimmed).origin);
    } catch {
      throw new ConfigError(`Ungültige Konfiguration:
  - ALLOWED_ORIGINS: „${trimmed}“ ist keine gültige Adresse (z. B. http://localhost:5173)`);
    }
  }
  return origins;
}

function parseHosts(raw: string | undefined): string[] {
  const hosts: string[] = [];
  for (const entry of (raw ?? '').split(',')) {
    const trimmed = entry.trim();
    if (trimmed === '') continue;
    const hostname = parseHostHeader(trimmed);
    if (hostname === null) {
      throw new ConfigError(`Ungültige Konfiguration:
  - ALLOWED_HOSTS: „${trimmed}“ ist kein gültiger Hostname (z. B. craft.example.lan)`);
    }
    hosts.push(hostname);
  }
  return hosts;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
    throw new ConfigError(`Ungültige Konfiguration:\n${lines.join('\n')}`);
  }
  const env = parsed.data;
  return {
    host: env.HOST,
    port: env.PORT,
    dataDir: path.resolve(REPO_ROOT, env.DATA_DIR),
    serversDir: path.resolve(REPO_ROOT, env.SERVERS_DIR),
    frontendDir: path.resolve(REPO_ROOT, env.FRONTEND_DIR),
    logLevel: env.LOG_LEVEL,
    ...(env.MODRINTH_USER_AGENT === undefined ? {} : { modrinthUserAgent: env.MODRINTH_USER_AGENT }),
    ...(env.AUTH_TOKEN === undefined ? {} : { authToken: env.AUTH_TOKEN }),
    allowedOrigins: parseOrigins(env.ALLOWED_ORIGINS),
    allowedHosts: parseHosts(env.ALLOWED_HOSTS),
    stopTimeoutMs: env.STOP_TIMEOUT_SECONDS * 1000,
  };
}

export function loadDotEnv(): void {
  const file = path.join(REPO_ROOT, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}
