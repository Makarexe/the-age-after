import { desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { news, skins, users, type User } from '../db/schema.js';
import { offlineUuid, sha256Hex, undashed } from '../lib/crypto.js';
import { badRequest, conflict, forbidden, unauthorized } from '../lib/errors.js';
import { isValidSkinSize, readPngSize } from '../lib/png.js';
import { parse } from '../lib/validate.js';
import { resetPasswordMail } from '../services/mails.js';
import { hashPassword, verifyPassword } from '../services/passwords.js';
import { textureUrl } from '../services/profile.js';
import { notifyAdminAboutApplication, sendSafely, sendVerification } from '../services/registration.js';
import { consumeEmailToken, createEmailToken, findSession, revokeAllTokens } from '../services/tokens.js';
import { findUserByLogin, isUniqueViolation } from '../services/users.js';

const MAX_SKIN_BYTES = 64 * 1024;

export const usernameSchema = z
  .string({ error: 'Укажите ник.' })
  .regex(/^[A-Za-z0-9_]{3,16}$/, 'Ник: 3–16 символов, только латиница, цифры и _.');
export const passwordSchema = z
  .string({ error: 'Укажите пароль.' })
  .min(8, 'Пароль должен быть не короче 8 символов.')
  .max(128, 'Пароль слишком длинный.');
const emailSchema = z
  .string({ error: 'Укажите почту.' })
  .trim()
  .max(254, 'Почта слишком длинная.')
  .pipe(z.email('Неверный адрес почты.'));
const loginSchema = z.object({ login: z.string().trim().min(1, 'Укажите ник или почту.').max(254) });

const registerBody = z.object({ username: usernameSchema, email: emailSchema, password: passwordSchema });
const resetBody = z.object({ token: z.string().min(1).max(128), password: passwordSchema });
const changePasswordBody = z.object({ oldPassword: z.string().min(1).max(256), newPassword: passwordSchema });
const skinBody = z.object({
  /** Without png only the model of the current skin changes. */
  png: z.string().min(1, 'Нет файла скина.').max(MAX_SKIN_BYTES * 2).optional(),
  model: z.enum(['classic', 'slim']).default('classic'),
});

export function meResponse(user: User, publicUrl: string) {
  return {
    id: undashed(user.id),
    username: user.username,
    email: user.email,
    status: user.status,
    isAdmin: user.isAdmin,
    skin: user.skinSha256 ? { url: textureUrl(publicUrl, user.skinSha256), model: user.skinModel } : null,
    createdAt: user.createdAt.toISOString(),
  };
}

export async function resetPassword(ctx: AppContext, token: string, password: string): Promise<void> {
  const userId = await consumeEmailToken(ctx.db, token, 'reset');
  if (!userId) throw badRequest('Ссылка недействительна или устарела. Запросите сброс пароля ещё раз.');
  await ctx.db
    .update(users)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(users.id, userId));
  await revokeAllTokens(ctx.db, userId);
}

export function launcherRoutes(ctx: AppContext): FastifyPluginAsync {
  const { db, config, mailer } = ctx;

  async function requireSession(req: FastifyRequest) {
    const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const session = token ? await findSession(db, token) : null;
    if (!session) throw unauthorized();
    return session;
  }

  return async (app) => {
    app.get('/config', async () => ({
      serverName: config.serverName,
      serverAddress: config.serverAddress,
      packManifestUrl: config.packManifestUrl,
      apiRoot: config.publicUrl,
    }));

    app.post(
      '/register',
      { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
      async (req, reply) => {
        const body = parse(registerBody, req.body);
        if (await findUserByLogin(db, body.username)) throw conflict('Этот ник уже занят.');
        if (await findUserByLogin(db, body.email)) throw conflict('Эта почта уже используется.');

        let user: User;
        try {
          [user] = (await db
            .insert(users)
            .values({
              id: offlineUuid(body.username),
              username: body.username,
              email: body.email,
              passwordHash: await hashPassword(body.password),
              status: mailer.configured ? 'pending_email' : 'pending_approval',
            })
            .returning()) as [User];
        } catch (err) {
          if (isUniqueViolation(err)) throw conflict('Этот ник или почта уже заняты.');
          throw err;
        }
        req.log.info({ username: user.username }, 'Новая регистрация');

        let mailSent = false;
        if (user.status === 'pending_email') mailSent = await sendVerification(ctx, req.log, user);
        else notifyAdminAboutApplication(ctx, req.log, user);

        return reply.status(201).send({ status: user.status, mailSent });
      },
    );

    app.post(
      '/resend-verification',
      { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
      async (req, reply) => {
        const { login } = parse(loginSchema, req.body);
        const user = await findUserByLogin(db, login);
        // Same answer whether or not the account exists.
        if (user?.status === 'pending_email') await sendVerification(ctx, req.log, user);
        return reply.status(204).send();
      },
    );

    app.post(
      '/forgot-password',
      { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
      async (req, reply) => {
        const { login } = parse(loginSchema, req.body);
        const user = await findUserByLogin(db, login);
        if (user && user.status !== 'banned') {
          const token = await createEmailToken(db, user.id, 'reset');
          await sendSafely(ctx, req.log, resetPasswordMail(config, user.email, user.username, token));
        }
        return reply.status(204).send();
      },
    );

    app.post(
      '/reset-password',
      { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
      async (req, reply) => {
        const body = parse(resetBody, req.body);
        await resetPassword(ctx, body.token, body.password);
        return reply.status(204).send();
      },
    );

    app.get('/me', async (req) => {
      const { user } = await requireSession(req);
      return meResponse(user, config.publicUrl);
    });

    app.post(
      '/change-password',
      { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
      async (req, reply) => {
        const session = await requireSession(req);
        const body = parse(changePasswordBody, req.body);
        if (!(await verifyPassword(session.user.passwordHash, body.oldPassword))) {
          throw forbidden('Текущий пароль указан неверно.');
        }
        await db
          .update(users)
          .set({ passwordHash: await hashPassword(body.newPassword) })
          .where(eq(users.id, session.user.id));
        await revokeAllTokens(db, session.user.id, session.tokenHash);
        return reply.status(204).send();
      },
    );

    app.post('/skin', async (req) => {
      const session = await requireSession(req);
      const body = parse(skinBody, req.body);
      if (body.png === undefined) {
        if (!session.user.skinSha256) throw badRequest('Сначала загрузите скин.');
        const [user] = await db.update(users).set({ skinModel: body.model }).where(eq(users.id, session.user.id)).returning();
        return meResponse(user!, config.publicUrl);
      }
      const png = Buffer.from(body.png.replace(/^data:image\/png;base64,/, ''), 'base64');
      if (png.length > MAX_SKIN_BYTES) throw badRequest('Файл скина слишком большой.');
      const size = readPngSize(png);
      if (!size) throw badRequest('Скин должен быть PNG-файлом.');
      if (!isValidSkinSize(size)) throw badRequest('Скин должен быть 64×64 или 64×32 пикселя.');

      const sha256 = sha256Hex(png);
      await db.insert(skins).values({ sha256, png }).onConflictDoNothing();
      const [user] = await db
        .update(users)
        .set({ skinSha256: sha256, skinModel: body.model })
        .where(eq(users.id, session.user.id))
        .returning();
      return meResponse(user!, config.publicUrl);
    });

    app.delete('/skin', async (req) => {
      const session = await requireSession(req);
      const [user] = await db
        .update(users)
        .set({ skinSha256: null, skinModel: 'classic' })
        .where(eq(users.id, session.user.id))
        .returning();
      return meResponse(user!, config.publicUrl);
    });

    app.get('/news', async () => {
      const rows = await db
        .select({ id: news.id, title: news.title, body: news.body, createdAt: news.createdAt })
        .from(news)
        .orderBy(desc(news.createdAt))
        .limit(20);
      return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
    });
  };
}
