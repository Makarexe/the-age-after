import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { users } from '../db/schema.js';
import { undashed } from '../lib/crypto.js';
import { forbidden, INVALID_CREDENTIALS, INVALID_TOKEN, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { verifyPassword } from '../services/passwords.js';
import { fullProfile, shortProfile } from '../services/profile.js';
import { issueProfileKeyPair } from '../services/profile-keys.js';
import {
  findSession,
  issueAccessToken,
  newClientToken,
  revokeAllTokens,
  revokeToken,
} from '../services/tokens.js';
import { findUserById, findUserByLogin, findUserByName, STATUS_MESSAGES } from '../services/users.js';
import type { User } from '../db/schema.js';

const STRICT_LIMIT = { rateLimit: { max: 10, timeWindow: '1 minute' } };
const LOOSE_LIMIT = { rateLimit: { max: 60, timeWindow: '1 minute' } };

const authenticateBody = z.object({
  username: z.string().min(1).max(254),
  password: z.string().min(1).max(256),
  clientToken: z.string().min(1).max(128).optional(),
  requestUser: z.boolean().optional(),
});

const refreshBody = z.object({
  accessToken: z.string().min(1).max(256),
  clientToken: z.string().max(128).optional(),
  requestUser: z.boolean().optional(),
  selectedProfile: z.object({ id: z.string(), name: z.string() }).optional(),
});

const tokenBody = z.object({
  accessToken: z.string().min(1).max(256),
  clientToken: z.string().max(128).optional(),
});

const signoutBody = z.object({
  username: z.string().min(1).max(254),
  password: z.string().min(1).max(256),
});

const joinBody = z.object({
  accessToken: z.string().min(1).max(256),
  selectedProfile: z.string().min(1).max(64),
  serverId: z.string().min(1).max(128),
});

const NAME_RE = /^[A-Za-z0-9_]{1,16}$/;

function userObject(user: User) {
  return { id: undashed(user.id), properties: [{ name: 'preferredLanguage', value: 'ru' }] };
}

/** Checks password and status; the error text is shown by the launcher as is. */
async function checkCredentials(ctx: AppContext, login: string, password: string): Promise<User> {
  const user = await findUserByLogin(ctx.db, login);
  const ok = await verifyPassword(user?.passwordHash, password);
  if (!user || !ok) throw forbidden(INVALID_CREDENTIALS);
  if (user.status !== 'active') throw forbidden(STATUS_MESSAGES[user.status]);
  return user;
}

export function yggdrasilRoutes(ctx: AppContext): FastifyPluginAsync {
  const { db, config, signer, joins } = ctx;

  return async (app) => {
    app.get('/', async () => {
      const host = new URL(config.publicUrl).hostname;
      return {
        meta: {
          serverName: config.serverName,
          implementationName: 'the-age-after',
          implementationVersion: '0.1.0',
          links: { homepage: config.publicUrl, register: config.publicUrl },
          'feature.non_email_login': true,
          'feature.no_mojang_namespace': true,
          'feature.enable_profile_key': true,
        },
        skinDomains: [host],
        signaturePublickey: signer.publicKeyPem,
      };
    });

    // ---- authserver ----

    app.post('/authserver/authenticate', { config: STRICT_LIMIT }, async (req) => {
      const body = parse(authenticateBody, req.body);
      const user = await checkCredentials(ctx, body.username, body.password);
      const clientToken = body.clientToken ?? newClientToken();
      const accessToken = await issueAccessToken(db, user.id, clientToken);
      const profile = shortProfile(user);
      return {
        accessToken,
        clientToken,
        availableProfiles: [profile],
        selectedProfile: profile,
        ...(body.requestUser ? { user: userObject(user) } : {}),
      };
    });

    app.post('/authserver/refresh', { config: LOOSE_LIMIT }, async (req) => {
      const body = parse(refreshBody, req.body);
      const session = await findSession(db, body.accessToken, body.clientToken || undefined);
      if (!session) throw forbidden(INVALID_TOKEN);
      if (body.selectedProfile && undashed(body.selectedProfile.id) !== undashed(session.user.id)) {
        throw forbidden('Профиль не принадлежит этому аккаунту.');
      }
      await revokeToken(db, body.accessToken);
      const accessToken = await issueAccessToken(db, session.user.id, session.clientToken);
      return {
        accessToken,
        clientToken: session.clientToken,
        selectedProfile: shortProfile(session.user),
        ...(body.requestUser ? { user: userObject(session.user) } : {}),
      };
    });

    app.post('/authserver/validate', { config: LOOSE_LIMIT }, async (req, reply) => {
      const body = parse(tokenBody, req.body);
      const session = await findSession(db, body.accessToken, body.clientToken || undefined);
      if (!session) throw forbidden(INVALID_TOKEN);
      return reply.status(204).send();
    });

    app.post('/authserver/invalidate', { config: LOOSE_LIMIT }, async (req, reply) => {
      const body = parse(tokenBody, req.body);
      await revokeToken(db, body.accessToken);
      return reply.status(204).send();
    });

    app.post('/authserver/signout', { config: STRICT_LIMIT }, async (req, reply) => {
      const body = parse(signoutBody, req.body);
      const user = await findUserByLogin(db, body.username);
      if (!user || !(await verifyPassword(user.passwordHash, body.password))) {
        throw forbidden(INVALID_CREDENTIALS);
      }
      await revokeAllTokens(db, user.id);
      return reply.status(204).send();
    });

    // ---- sessionserver ----

    app.post('/sessionserver/session/minecraft/join', { config: LOOSE_LIMIT }, async (req, reply) => {
      const body = parse(joinBody, req.body);
      const session = await findSession(db, body.accessToken);
      if (!session || undashed(body.selectedProfile) !== undashed(session.user.id)) {
        throw forbidden(INVALID_TOKEN);
      }
      joins.add(body.serverId, session.user.id, session.user.username, req.ip);
      return reply.status(204).send();
    });

    app.get('/sessionserver/session/minecraft/hasJoined', async (req, reply) => {
      const q = req.query as { username?: string; serverId?: string };
      if (!q.username || !q.serverId) return reply.status(204).send();
      const join = joins.get(q.serverId);
      if (!join || join.username.toLowerCase() !== q.username.toLowerCase()) return reply.status(204).send();
      const user = await findUserById(db, join.userId);
      if (!user || user.status !== 'active') return reply.status(204).send();
      return fullProfile(user, { publicUrl: config.publicUrl, signer, signed: true });
    });

    app.get('/sessionserver/session/minecraft/profile/:uuid', async (req, reply) => {
      const { uuid } = req.params as { uuid: string };
      const { unsigned } = req.query as { unsigned?: string };
      const user = await findUserById(db, uuid);
      if (!user || user.status !== 'active') return reply.status(204).send();
      return fullProfile(user, { publicUrl: config.publicUrl, signer, signed: unsigned === 'false' });
    });

    // ---- name lookups (api.mojang.com and api.minecraftservices.com shapes) ----

    async function lookupNames(body: unknown) {
      const names = z.array(z.string()).max(100).safeParse(body);
      if (!names.success) return [];
      const wanted = [...new Set(names.data.filter((n) => NAME_RE.test(n)).map((n) => n.toLowerCase()))];
      if (wanted.length === 0) return [];
      const rows = await db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(
          sql`lower(${users.username}) in (${sql.join(
            wanted.map((n) => sql`${n}`),
            sql`, `,
          )}) and ${users.status} = 'active'`,
        );
      return rows.map(shortProfile);
    }

    async function lookupName(name: string) {
      if (!NAME_RE.test(name)) return undefined;
      const user = await findUserByName(db, name);
      return user && user.status === 'active' ? shortProfile(user) : undefined;
    }

    app.post('/api/profiles/minecraft', async (req) => lookupNames(req.body));
    app.post('/minecraftservices/minecraft/profile/lookup/bulk/byname', async (req) => lookupNames(req.body));

    app.get('/api/users/profiles/minecraft/:name', async (req, reply) => {
      const profile = await lookupName((req.params as { name: string }).name);
      return profile ?? reply.status(204).send();
    });
    app.get('/minecraftservices/minecraft/profile/lookup/name/:name', async (req) => {
      const profile = await lookupName((req.params as { name: string }).name);
      if (!profile) throw notFound('Couldn\'t find any profile with that name');
      return profile;
    });

    // ---- minecraftservices ----

    app.get('/minecraftservices/publickeys', async () => {
      const key = { publicKey: signer.publicKeyDerBase64 };
      return { profilePropertyKeys: [key], playerCertificateKeys: [key] };
    });

    async function bearerSession(authorization: string | undefined) {
      const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
      const session = token ? await findSession(db, token) : null;
      if (!session) throw forbidden(INVALID_TOKEN);
      return session;
    }

    app.get('/minecraftservices/player/attributes', async (req) => {
      await bearerSession(req.headers.authorization);
      return {
        privileges: {
          onlineChat: { enabled: true },
          multiplayerServer: { enabled: true },
          multiplayerRealms: { enabled: false },
          telemetry: { enabled: false },
          optionalTelemetry: { enabled: false },
        },
        profanityFilterPreferences: { profanityFilterOn: false },
        banStatus: { bannedScopes: {} },
      };
    });

    app.get('/minecraftservices/privacy/blocklist', async (req) => {
      await bearerSession(req.headers.authorization);
      return { blockedProfiles: [] };
    });

    app.get('/minecraftservices/minecraft/profile', async (req) => {
      const { user } = await bearerSession(req.headers.authorization);
      return { ...shortProfile(user), skins: [], capes: [] };
    });

    // Chat-signing keys signed by us: the MC server kicks players whose profile key it can't verify.
    app.post('/minecraftservices/player/certificates', { config: LOOSE_LIMIT }, async (req) => {
      const { user } = await bearerSession(req.headers.authorization);
      return issueProfileKeyPair(user.id, signer);
    });
  };
}
