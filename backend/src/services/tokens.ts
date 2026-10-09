import { and, asc, eq, gt, inArray, lt, ne } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { DB } from '../db/index.js';
import { accessTokens, emailTokens, users, type EmailTokenPurpose, type User } from '../db/schema.js';
import { randomToken, sha256Hex, undashed } from '../lib/crypto.js';

export const ACCESS_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TOKENS_PER_USER = 10;

export const EMAIL_TOKEN_TTL_MS: Record<EmailTokenPurpose, number> = {
  verify: 24 * 60 * 60 * 1000,
  reset: 60 * 60 * 1000,
};

export function newClientToken(): string {
  return undashed(randomUUID());
}

export async function issueAccessToken(db: DB, userId: string, clientToken: string): Promise<string> {
  const token = randomToken();
  await db.insert(accessTokens).values({
    tokenHash: sha256Hex(token),
    clientToken,
    userId,
    expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MS),
  });
  // Keep only the newest tokens: old launchers/devices get logged out.
  const rows = await db
    .select({ tokenHash: accessTokens.tokenHash })
    .from(accessTokens)
    .where(eq(accessTokens.userId, userId))
    .orderBy(asc(accessTokens.createdAt));
  if (rows.length > MAX_TOKENS_PER_USER) {
    const stale = rows.slice(0, rows.length - MAX_TOKENS_PER_USER).map((r) => r.tokenHash);
    await db.delete(accessTokens).where(inArray(accessTokens.tokenHash, stale));
  }
  return token;
}

export interface TokenSession {
  tokenHash: string;
  clientToken: string;
  user: User;
}

/** Valid = exists, not expired, clientToken matches (if given) and the user is active. */
export async function findSession(db: DB, accessToken: string, clientToken?: string): Promise<TokenSession | null> {
  if (!accessToken) return null;
  const tokenHash = sha256Hex(accessToken);
  const [row] = await db
    .select({ clientToken: accessTokens.clientToken, user: users })
    .from(accessTokens)
    .innerJoin(users, eq(users.id, accessTokens.userId))
    .where(and(eq(accessTokens.tokenHash, tokenHash), gt(accessTokens.expiresAt, new Date())))
    .limit(1);
  if (!row || row.user.status !== 'active') return null;
  if (clientToken && clientToken !== row.clientToken) return null;
  return { tokenHash, clientToken: row.clientToken, user: row.user };
}

export async function revokeToken(db: DB, accessToken: string): Promise<void> {
  await db.delete(accessTokens).where(eq(accessTokens.tokenHash, sha256Hex(accessToken)));
}

export async function revokeAllTokens(db: DB, userId: string, exceptTokenHash?: string): Promise<void> {
  await db
    .delete(accessTokens)
    .where(
      exceptTokenHash
        ? and(eq(accessTokens.userId, userId), ne(accessTokens.tokenHash, exceptTokenHash))
        : eq(accessTokens.userId, userId),
    );
}

export async function createEmailToken(db: DB, userId: string, purpose: EmailTokenPurpose): Promise<string> {
  const token = randomToken();
  await db.delete(emailTokens).where(and(eq(emailTokens.userId, userId), eq(emailTokens.purpose, purpose)));
  await db.insert(emailTokens).values({
    tokenHash: sha256Hex(token),
    userId,
    purpose,
    expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS[purpose]),
  });
  return token;
}

/** Looks up a one-time email token without using it up (to show the reset form). */
export async function peekEmailToken(db: DB, token: string, purpose: EmailTokenPurpose): Promise<string | null> {
  const [row] = await db
    .select({ userId: emailTokens.userId })
    .from(emailTokens)
    .where(
      and(
        eq(emailTokens.tokenHash, sha256Hex(token)),
        eq(emailTokens.purpose, purpose),
        gt(emailTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row?.userId ?? null;
}

/** Deletes the token and returns its user id, or null if it is unknown, used or expired. */
export async function consumeEmailToken(db: DB, token: string, purpose: EmailTokenPurpose): Promise<string | null> {
  const [row] = await db
    .delete(emailTokens)
    .where(and(eq(emailTokens.tokenHash, sha256Hex(token)), eq(emailTokens.purpose, purpose)))
    .returning({ userId: emailTokens.userId, expiresAt: emailTokens.expiresAt });
  if (!row || row.expiresAt.getTime() <= Date.now()) return null;
  return row.userId;
}

export async function purgeExpired(db: DB): Promise<void> {
  const now = new Date();
  await db.delete(accessTokens).where(lt(accessTokens.expiresAt, now));
  await db.delete(emailTokens).where(lt(emailTokens.expiresAt, now));
}
