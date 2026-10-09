import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { AppContext } from '../context.js';
import { users, type User } from '../db/schema.js';
import { adminNewApplicationMail, verifyEmailMail } from './mails.js';
import { createEmailToken } from './tokens.js';

/** Sends mail without failing the request: SMTP problems end up in the log. */
export async function sendSafely(
  ctx: AppContext,
  log: FastifyBaseLogger,
  mail: Parameters<AppContext['mailer']['send']>[0],
): Promise<boolean> {
  try {
    await ctx.mailer.send(mail);
    return true;
  } catch (err) {
    log.error({ err, to: mail.to, subject: mail.subject }, 'Не удалось отправить письмо');
    return false;
  }
}

export async function sendVerification(ctx: AppContext, log: FastifyBaseLogger, user: User): Promise<boolean> {
  const token = await createEmailToken(ctx.db, user.id, 'verify');
  return sendSafely(ctx, log, verifyEmailMail(ctx.config, user.email, user.username, token));
}

export function notifyAdminAboutApplication(ctx: AppContext, log: FastifyBaseLogger, user: User): void {
  const to = ctx.config.adminNotifyEmail;
  if (!to) return;
  void sendSafely(ctx, log, adminNewApplicationMail(ctx.config, to, user.username, user.email));
}

/** pending_email → pending_approval after the link from the email is opened. */
export async function markEmailVerified(ctx: AppContext, log: FastifyBaseLogger, user: User): Promise<User> {
  if (user.status !== 'pending_email') return user;
  const [updated] = await ctx.db
    .update(users)
    .set({ status: 'pending_approval', emailVerifiedAt: new Date() })
    .where(eq(users.id, user.id))
    .returning();
  notifyAdminAboutApplication(ctx, log, updated!);
  return updated!;
}
