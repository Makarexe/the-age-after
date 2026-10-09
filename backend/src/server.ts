import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { connectPostgres } from './db/index.js';
import { createLogMailer, createSmtpMailer } from './lib/mailer.js';
import { createSigner, generatePrivateKeyPem } from './lib/signing.js';
import { purgeExpired } from './services/tokens.js';

const config = loadConfig();
const logger = { level: process.env.LOG_LEVEL ?? 'info' };

let privateKey = config.signingPrivateKey;
if (!privateKey) {
  if (config.production) throw new Error('SIGNING_PRIVATE_KEY is required in production (npm run gen-key)');
  privateKey = generatePrivateKeyPem(2048);
}

const { db, close } = await connectPostgres(config.databaseUrl);
const signer = createSigner(privateKey);

// The logger only exists after the app is built, so the mailer gets it lazily.
const mailer = config.smtp ? createSmtpMailer(config.smtp) : createLogMailer(() => app.log);

const app = await buildApp({ config, db, signer, mailer, logger });
if (!config.signingPrivateKey) app.log.warn('SIGNING_PRIVATE_KEY не задан: сгенерирован временный ключ (только для разработки)');
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
