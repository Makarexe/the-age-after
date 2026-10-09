import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { migrationsFolder, schema, type DB } from '../src/db/index.js';
import type { Mail, Mailer } from '../src/lib/mailer.js';
import { createSigner, generatePrivateKeyPem } from '../src/lib/signing.js';

export const PUBLIC_URL = 'https://auth.example.test';

let keyPem: string | undefined;

export interface TestApp {
  app: FastifyInstance;
  db: DB;
  mails: Mail[];
  close: () => Promise<void>;
}

export async function createTestApp(opts: { smtp?: boolean } = {}): Promise<TestApp> {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as DB;
  await migrate(drizzle(client, { schema }), { migrationsFolder });

  const mails: Mail[] = [];
  const mailer: Mailer = {
    configured: opts.smtp ?? true,
    async send(mail) {
      mails.push(mail);
    },
  };
  const config: Config = {
    port: 0,
    host: '127.0.0.1',
    databaseUrl: 'pglite://memory',
    publicUrl: PUBLIC_URL,
    serverName: 'The Age After',
    serverAddress: 'play.example.test',
    packManifestUrl: 'https://example.test/manifest.json',
    adminNotifyEmail: 'admin@example.test',
    trustProxyHops: 0,
    production: false,
  };
  keyPem ??= generatePrivateKeyPem(2048);
  const app = await buildApp({ config, db, signer: createSigner(keyPem), mailer });
  await app.ready();
  return {
    app,
    db,
    mails,
    close: async () => {
      await app.close();
      await client.close();
    },
  };
}

export function tokenFromMail(mail: Mail | undefined, path: '/verify' | '/reset'): string {
  const match = mail?.text.match(new RegExp(`${PUBLIC_URL}${path}\\?token=([A-Za-z0-9_-]+)`));
  if (!match) throw new Error(`no ${path} link in mail: ${mail?.text}`);
  return match[1]!;
}

let ipCounter = 0;

/** Each call comes from its own IP so the register rate limit doesn't interfere with tests. */
export async function register(app: FastifyInstance, username: string, password = 'password123', email?: string) {
  ipCounter++;
  return app.inject({
    method: 'POST',
    url: '/launcher/register',
    remoteAddress: `10.1.${ipCounter >> 8}.${ipCounter & 255}`,
    payload: { username, email: email ?? `${username.toLowerCase()}@example.test`, password },
  });
}

/** Creates an active admin straight in the DB (what make-admin does). */
export async function createAdmin(t: TestApp, username = 'Admin', password = 'adminpass123') {
  await register(t.app, username, password);
  await t.db
    .update(schema.users)
    .set({ isAdmin: true, status: 'active' })
    .where(eq(schema.users.username, username));
  const res = await t.app.inject({ method: 'POST', url: '/admin/api/login', payload: { login: username, password } });
  return res.json().token as string;
}

/** Registers and activates a player via the admin API; returns nothing, use authenticate after. */
export async function createActivePlayer(t: TestApp, adminToken: string, username: string, password = 'password123') {
  const reg = await register(t.app, username, password);
  if (reg.statusCode !== 201) throw new Error(`register failed: ${reg.body}`);
  const users = (await t.app.inject({ method: 'GET', url: '/admin/api/users', headers: { authorization: `Bearer ${adminToken}` } })).json();
  const user = users.find((u: { username: string }) => u.username === username);
  const res = await t.app.inject({
    method: 'POST',
    url: `/admin/api/users/${user.id}/approve`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {},
  });
  if (res.statusCode !== 200) throw new Error(`approve failed: ${res.body}`);
}

export async function authenticate(app: FastifyInstance, username: string, password = 'password123', clientToken?: string) {
  return app.inject({
    method: 'POST',
    url: '/authserver/authenticate',
    payload: { username, password, clientToken, requestUser: true, agent: { name: 'Minecraft', version: 1 } },
  });
}
