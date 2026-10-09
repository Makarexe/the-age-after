import formbody from '@fastify/formbody';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Config } from './config.js';
import type { AppContext } from './context.js';
import type { DB } from './db/index.js';
import { ApiError, tooManyRequests } from './lib/errors.js';
import type { Mailer } from './lib/mailer.js';
import type { Signer } from './lib/signing.js';
import { adminRoutes } from './routes/admin.js';
import { launcherRoutes } from './routes/launcher.js';
import { pageRoutes } from './routes/pages.js';
import { yggdrasilRoutes } from './routes/yggdrasil.js';
import { JoinStore } from './services/joins.js';

export interface BuildAppOptions {
  config: Config;
  db: DB;
  signer: Signer;
  mailer: Mailer;
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    // Trust exactly N proxy hops (Railway adds one): a client-supplied X-Forwarded-For can't spoof the IP.
    trustProxy: (_addr: string, hop: number) => hop < opts.config.trustProxyHops,
    bodyLimit: 1024 * 1024,
  });

  const ctx: AppContext = {
    config: opts.config,
    db: opts.db,
    signer: opts.signer,
    mailer: opts.mailer,
    joins: new JoinStore(),
  };

  await app.register(formbody);
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => tooManyRequests(),
  });

  app.addHook('onSend', async (_req, reply) => {
    // authlib-injector "API location indication": lets any launcher find the API from the domain.
    reply.header('X-Authlib-Injector-API-Location', '/');
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      return reply.status(err.statusCode).send({ error: err.error, errorMessage: err.message });
    }
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply
        .status(statusCode)
        .send({ error: 'IllegalArgumentException', errorMessage: (err as Error).message });
    }
    req.log.error({ err }, 'Unhandled error');
    return reply.status(500).send({ error: 'InternalError', errorMessage: 'Внутренняя ошибка сервера.' });
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ error: 'NotFound', errorMessage: 'Not found.' });
  });

  app.get('/health', async () => ({ ok: true }));

  await app.register(yggdrasilRoutes(ctx));
  await app.register(launcherRoutes(ctx), { prefix: '/launcher' });
  await app.register(pageRoutes(ctx));
  await app.register(adminRoutes(ctx));

  return app;
}
