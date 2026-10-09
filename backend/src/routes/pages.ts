import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { AppContext } from '../context.js';
import { skins } from '../db/schema.js';
import { ApiError } from '../lib/errors.js';
import { escapeHtml, page } from '../lib/html.js';
import { markEmailVerified } from '../services/registration.js';
import { consumeEmailToken, peekEmailToken } from '../services/tokens.js';
import { findUserById } from '../services/users.js';
import { passwordSchema, resetPassword } from './launcher.js';

function html(reply: FastifyReply, status: number, body: string) {
  return reply
    .status(status)
    .header('Content-Type', 'text/html; charset=utf-8')
    .header('Cache-Control', 'no-store')
    .header('Referrer-Policy', 'no-referrer')
    .header('X-Frame-Options', 'DENY')
    .send(body);
}

const p = (text: string) => `<p>${escapeHtml(text)}</p>`;

export function pageRoutes(ctx: AppContext): FastifyPluginAsync {
  const brand = ctx.config.serverName;
  const resetForm = (token: string, error?: string) =>
    page(
      'Новый пароль',
      (error ? `<p style="color:#c0392b">${escapeHtml(error)}</p>` : '') +
        `<form method="post" action="/reset">
<input type="hidden" name="token" value="${escapeHtml(token)}">
<label for="password">Новый пароль (не короче 8 символов)</label>
<input id="password" name="password" type="password" minlength="8" maxlength="128" required autocomplete="new-password">
<label for="password2">Повторите пароль</label>
<input id="password2" name="password2" type="password" minlength="8" maxlength="128" required autocomplete="new-password">
<button type="submit">Сохранить</button></form>`,
      brand,
    );

  return async (app) => {
    app.get('/verify', async (req, reply) => {
      const { token } = req.query as { token?: string };
      const userId = token ? await consumeEmailToken(ctx.db, token, 'verify') : null;
      const user = userId ? await findUserById(ctx.db, userId) : undefined;
      if (!user) {
        return html(
          reply,
          400,
          page('Ссылка не работает', p('Ссылка недействительна или устарела. Запросите новое письмо в лаунчере.'), brand),
        );
      }
      const updated = await markEmailVerified(ctx, req.log, user);
      const text =
        updated.status === 'active'
          ? 'Почта подтверждена. Аккаунт уже активен — можно входить в лаунчер.'
          : 'Почта подтверждена. Заявка отправлена администратору — после одобрения можно будет войти в лаунчер.';
      return html(reply, 200, page('Почта подтверждена', p(text), brand));
    });

    app.get('/reset', async (req, reply) => {
      const { token } = req.query as { token?: string };
      if (!token || !(await peekEmailToken(ctx.db, token, 'reset'))) {
        return html(
          reply,
          400,
          page('Ссылка не работает', p('Ссылка недействительна или устарела. Запросите сброс пароля ещё раз.'), brand),
        );
      }
      return html(reply, 200, resetForm(token));
    });

    app.post('/reset', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) => {
      const body = (req.body ?? {}) as { token?: string; password?: string; password2?: string };
      const token = String(body.token ?? '');
      const password = String(body.password ?? '');
      if (password !== String(body.password2 ?? '')) return html(reply, 400, resetForm(token, 'Пароли не совпадают.'));
      const parsed = passwordSchema.safeParse(password);
      if (!parsed.success) return html(reply, 400, resetForm(token, parsed.error.issues[0]!.message));
      try {
        await resetPassword(ctx, token, password);
      } catch (err) {
        if (err instanceof ApiError) return html(reply, 400, page('Ссылка не работает', p(err.message), brand));
        throw err;
      }
      return html(reply, 200, page('Пароль изменён', p('Готово. Теперь войдите в лаунчер с новым паролем.'), brand));
    });

    app.get('/textures/:hash', async (req, reply) => {
      const { hash } = req.params as { hash: string };
      if (!/^[0-9a-f]{64}$/.test(hash)) return reply.status(404).send();
      const [skin] = await ctx.db.select({ png: skins.png }).from(skins).where(eq(skins.sha256, hash)).limit(1);
      if (!skin) return reply.status(404).send();
      return reply
        .header('Content-Type', 'image/png')
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .send(skin.png);
    });
  };
}
