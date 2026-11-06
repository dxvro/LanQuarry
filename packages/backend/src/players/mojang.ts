import { z } from 'zod';
import { AppError } from '../http/errors.js';
import { dashUuid } from './uuid.js';

export const MOJANG_API = 'https://api.mojang.com';
export const LOOKUP_TIMEOUT_MS = 8000;

const profileSchema = z.object({ id: z.string().regex(/^[0-9a-fA-F]{32}$/), name: z.string().regex(/^\w{1,16}$/) });

export interface Profile {
  uuid: string;
  name: string;
}

export interface MojangOptions {
  fetch: typeof fetch;
  userAgent: string;
  baseUrl?: string;
  timeoutMs?: number;
}

const HINT = 'Alternativ den Server starten und den Spieler dort live hinzufügen.';
const unreachable = (reason: string): AppError => new AppError(502, 'PLAYER_LOOKUP_FAILED', `${reason} ${HINT}`);

// Only the player name goes over the wire; the result carries the canonical capitalisation
export async function lookupMojangProfile(name: string, options: MojangOptions): Promise<Profile> {
  const url = `${options.baseUrl ?? MOJANG_API}/users/profiles/minecraft/${encodeURIComponent(name)}`;
  let response: Response;
  try {
    response = await options.fetch(url, {
      headers: { 'User-Agent': options.userAgent, Accept: 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs ?? LOOKUP_TIMEOUT_MS),
    });
  } catch (error) {
    const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw unreachable(
      timeout ? 'Mojang hat nicht rechtzeitig geantwortet.' : 'Mojang ist nicht erreichbar, die UUID des Spielers konnte nicht ermittelt werden.',
    );
  }
  if (response.status === 404 || response.status === 204) {
    void response.body?.cancel().catch(() => undefined);
    throw new AppError(404, 'PLAYER_NOT_FOUND', `Spieler nicht gefunden: Der Name „${name}“ existiert bei Mojang nicht.`, { name });
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw unreachable(response.status === 429 ? 'Mojang begrenzt gerade die Anfragen.' : `Mojang hat die Anfrage nicht beantwortet (HTTP ${response.status}).`);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw unreachable('Mojang hat eine unerwartete Antwort geliefert.');
  }
  const parsed = profileSchema.safeParse(payload);
  if (!parsed.success) throw unreachable('Mojang hat eine unerwartete Antwort geliefert.');
  return { uuid: dashUuid(parsed.data.id), name: parsed.data.name };
}
