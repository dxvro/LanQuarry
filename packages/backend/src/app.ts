import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from './config/env.js';
import type { Db } from './db/client.js';
import { registerAuth } from './http/auth.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { registerHostGuard } from './http/host.js';
import { registerOriginGuard } from './http/origin.js';
import { registerHealthRoutes } from './http/routes/health.js';
import { registerModRoutes } from './http/routes/mods.js';
import { registerServerRoutes } from './http/routes/servers.js';
import { registerSystemRoutes } from './http/routes/system.js';
import { registerWebSocketRoutes } from './http/ws.js';
import { readVersion } from './lib/version.js';
import { createServices, type ServiceOptions, type Services } from './services.js';

declare module 'fastify' {
  interface FastifyInstance {
    services: Services;
  }
}

export interface AppContext {
  db: Db;
  config: AppConfig;
  version: string;
  services: Services;
}

export type BuildAppOptions = Omit<ServiceOptions, 'logger'>;

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const { db, config } = options;
  const app = Fastify({ logger: { level: config.logLevel }, forceCloseConnections: true });
  const services = createServices({ ...options, logger: app.log });
  const context: AppContext = { db, config, version: readVersion(), services };

  // clients send POSTs without a body but with Content-Type: application/json; that must not be a 400
  const parseJson = app.getDefaultJsonParser('error', 'error');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    if (typeof body !== 'string' || body.trim() === '') {
      done(null, undefined);
      return;
    }
    parseJson(request, body, done);
  });

  app.decorate('services', services);
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);
  registerHostGuard(app, config.allowedHosts);
  registerOriginGuard(app, config.allowedOrigins);
  registerAuth(app, services.auth);
  registerWebSocketRoutes(app, context);
  registerHealthRoutes(app, context);
  registerSystemRoutes(app, context);
  registerServerRoutes(app, context);
  registerModRoutes(app, services.mods);

  app.addHook('onReady', async () => {
    try {
      const recovered = await services.install.recoverInterrupted();
      if (recovered > 0) app.log.warn({ count: recovered }, 'Unterbrochene Installationen wurden als fehlgeschlagen markiert');
    } catch (error) {
      app.log.error({ err: error }, 'Unterbrochene Installationen konnten nicht geprüft werden');
    }
  });
  // safety net for embedders: closing the app never leaves a server process behind
  app.addHook('onClose', async () => {
    await services.manager.shutdown(config.stopTimeoutMs + 15_000);
    await services.install.shutdown();
  });

  return app;
}
