import { desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { auditLog, news, users, type User, type UserStatus } from '../db/schema.js';
import { undashed } from '../lib/crypto.js';
import { badRequest, forbidden, INVALID_CREDENTIALS, notFound, unauthorized } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { approvedMail } from '../services/mails.js';
import { verifyPassword } from '../services/passwords.js';
import { sendSafely } from '../services/registration.js';
import { findSession, issueAccessToken, revokeAllTokens, revokeToken } from '../services/tokens.js';
import { findUserById, findUserByLogin } from '../services/users.js';
import { adminPage } from './admin-page.js';

const loginBody = z.object({ login: z.string().trim().min(1).max(254), password: z.string().min(1).max(256) });
const actionBody = z.object({ reason: z.string().trim().max(500).optional() });
const newsBody = z.object({
  title: z.string().trim().min(1, 'Нужен заголовок.').max(200, 'Заголовок слишком длинный.'),
  body: z.string().trim().min(1, 'Нужен текст.').max(5000, 'Текст слишком длинный.'),
});

type Action = 'approve' | 'reject' | 'ban' | 'unban' | 'delete';

/** Which statuses each action may start from. */
const ALLOWED_FROM: Record<Action, UserStatus[]> = {
  approve: ['pending_email', 'pending_approval', 'rejected'],
  reject: ['pending_email', 'pending_approval'],
  ban: ['pending_email', 'pending_approval', 'active', 'rejected'],
  unban: ['banned'],
  delete: ['pending_email', 'pending_approval', 'rejected'],
};

function userRow(u: User) {
  return {
    id: undashed(u.id),
    username: u.username,
    email: u.email,
    status: u.status,
    isAdmin: u.isAdmin,
    statusReason: u.statusReason,
    createdAt: u.createdAt.toISOString(),
    emailVerifiedAt: u.emailVerifiedAt?.toISOString() ?? null,
    approvedAt: u.approvedAt?.toISOString() ?? null,
  };
}

export function adminRoutes(ctx: AppContext): FastifyPluginAsync {
  const { db, config } = ctx;

  async function requireAdmin(req: FastifyRequest) {
    const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const session = token ? await findSession(db, token) : null;
    if (!session) throw unauthorized();
    if (!session.user.isAdmin) throw forbidden('Нужны права администратора.');
    return session;
  }

  async function audit(adminId: string, action: string, target: User | null, details: Record<string, unknown> = {}) {
    await db.insert(auditLog).values({
      adminId,
      action,
      targetUserId: target?.id ?? null,
      details: target ? { username: target.username, ...details } : details,
    });
  }

  return async (app) => {
    app.get('/admin', async (_req, reply) => {
      return reply
        .header('Content-Type', 'text/html; charset=utf-8')
        .header('Cache-Control', 'no-store')
        .header('X-Frame-Options', 'DENY')
        .header('Referrer-Policy', 'no-referrer')
        .send(adminPage(config.serverName));
    });

    app.post('/admin/api/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
      const body = parse(loginBody, req.body);
      const user = await findUserByLogin(db, body.login);
      if (!user || !(await verifyPassword(user.passwordHash, body.password))) throw forbidden(INVALID_CREDENTIALS);
      if (!user.isAdmin || user.status !== 'active') throw forbidden('Нужны права администратора.');
      const token = await issueAccessToken(db, user.id, 'admin-panel');
      return { token, username: user.username };
    });

    app.post('/admin/api/logout', async (req, reply) => {
      await requireAdmin(req);
      const token = req.headers.authorization!.match(/^Bearer\s+(.+)$/i)![1]!;
      await revokeToken(db, token);
      return reply.status(204).send();
    });

    app.get('/admin/api/me', async (req) => {
      const { user } = await requireAdmin(req);
      return { username: user.username };
    });

    app.get('/admin/api/users', async (req) => {
      await requireAdmin(req);
      const rows = await db.select().from(users).orderBy(desc(users.createdAt)).limit(1000);
      return rows.map(userRow);
    });

    app.post('/admin/api/users/:id/:action', async (req) => {
      const { user: admin } = await requireAdmin(req);
      const { id, action } = req.params as { id: string; action: string };
      if (!Object.hasOwn(ALLOWED_FROM, action)) throw notFound();
      const act = action as Action;
      const { reason } = parse(actionBody, req.body);
      const target = await findUserById(db, id);
      if (!target) throw notFound('Пользователь не найден.');
      if (!ALLOWED_FROM[act].includes(target.status)) {
        throw badRequest('Это действие недоступно для аккаунта в текущем статусе.');
      }
      if (target.id === admin.id) throw badRequest('Нельзя применить это к своему аккаунту.');

      if (act === 'delete') {
        await audit(admin.id, 'delete', target, { email: target.email, status: target.status });
        await db.delete(users).where(eq(users.id, target.id));
        return { deleted: true };
      }

      const now = new Date();
      const patch: Partial<typeof users.$inferInsert> =
        act === 'approve' || act === 'unban'
          ? { status: 'active', statusReason: null, ...(act === 'approve' ? { approvedAt: now } : {}) }
          : { status: act === 'ban' ? 'banned' : 'rejected', statusReason: reason || null };
      const [updated] = await db.update(users).set(patch).where(eq(users.id, target.id)).returning();
      if (act === 'ban' || act === 'reject') await revokeAllTokens(db, target.id);
      await audit(admin.id, act, target, reason ? { reason } : {});
      if (act === 'approve') void sendSafely(ctx, req.log, approvedMail(config, target.email, target.username));
      return userRow(updated!);
    });

    app.get('/admin/api/news', async (req) => {
      await requireAdmin(req);
      const rows = await db.select().from(news).orderBy(desc(news.createdAt)).limit(100);
      return rows.map((r) => ({ id: r.id, title: r.title, body: r.body, createdAt: r.createdAt.toISOString() }));
    });

    app.post('/admin/api/news', async (req, reply) => {
      const { user: admin } = await requireAdmin(req);
      const body = parse(newsBody, req.body);
      const [item] = await db.insert(news).values({ ...body, authorId: admin.id }).returning();
      await audit(admin.id, 'news_create', null, { newsId: item!.id, title: item!.title });
      return reply.status(201).send({ id: item!.id, title: item!.title, body: item!.body, createdAt: item!.createdAt.toISOString() });
    });

    app.delete('/admin/api/news/:id', async (req, reply) => {
      const { user: admin } = await requireAdmin(req);
      const id = Number((req.params as { id: string }).id);
      if (!Number.isInteger(id)) throw notFound();
      const [item] = await db.delete(news).where(eq(news.id, id)).returning();
      if (!item) throw notFound('Новость не найдена.');
      await audit(admin.id, 'news_delete', null, { newsId: id, title: item.title });
      return reply.status(204).send();
    });

    app.get('/admin/api/audit', async (req) => {
      await requireAdmin(req);
      const rows = await db
        .select({
          id: auditLog.id,
          action: auditLog.action,
          details: auditLog.details,
          createdAt: auditLog.createdAt,
          admin: sql<string | null>`(select ${users.username} from ${users} where ${users.id} = ${auditLog.adminId})`,
        })
        .from(auditLog)
        .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
        .limit(200);
      return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
    });
  };
}
