import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getLanUrls } from '../../lib/network.js';
import { AppError } from '../errors.js';
import type { AppContext } from '../../app.js';

export function registerHealthRoutes(app: FastifyInstance, { db, config, version, services }: AppContext): void {
  app.get('/api/health', async (request) => {
    try {
      await db.run(sql`select 1`);
    } catch (error) {
      app.log.error({ err: error }, 'Datenbank-Healthcheck fehlgeschlagen');
      throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Die Datenbank ist nicht erreichbar.');
    }
    // without a valid login only the bare minimum is disclosed
    if (!services.auth.isAuthenticated(request)) return { status: 'ok' as const, database: 'ok' as const };
    return {
      status: 'ok' as const,
      version,
      uptimeSeconds: Math.round(process.uptime()),
      database: 'ok' as const,
      lanUrls: getLanUrls(config.port),
    };
  });
}
