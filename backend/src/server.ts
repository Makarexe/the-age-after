import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { connectPostgres } from './db/index.js';
import { createLogMailer, createSmtpMailer } from './lib/mailer.js';
import { createSigner } from './lib/signing.js';
import { loadOrCreateSigningKey } from './services/secrets.js';
import { purgeExpired } from './services/tokens.js';

const config = loadConfig();
const logger = { level: process.env.LOG_LEVEL ?? 'info' };

const { db, close } = await connectPostgres(config.databaseUrl);
// SIGNING_PRIVATE_KEY wins; otherwise a key generated on first start and stored in the database.
const storedKey = config.signingPrivateKey ? undefined : await loadOrCreateSigningKey(db);
const signer = createSigner(config.signingPrivateKey ?? storedKey!.pem);

// The logger only exists after the app is built, so the mailer gets it lazily.
const mailer = config.smtp ? createSmtpMailer(config.smtp) : createLogMailer(() => app.log);

const app = await buildApp({ config, db, signer, mailer, logger });
if (storedKey) {
  app.log.info(storedKey.created ? 'Создан ключ подписи, он сохранён в базе' : 'Ключ подписи взят из базы');
}
if (!config.smtp) app.log.warn('SMTP не настроен: письма пишутся в лог, подтверждение почты пропускается');

const purge = setInterval(() => purgeExpired(db).catch((err) => app.log.error({ err }, 'purge failed')), 60 * 60 * 1000);
purge.unref();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    app.log.info(`${signal}, остановка`);
    await app.close();
    await close();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: config.host });
