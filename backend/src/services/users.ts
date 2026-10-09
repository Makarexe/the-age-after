import { eq, sql } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import { users, type User } from '../db/schema.js';
import { parseUuid } from '../lib/crypto.js';

export async function findUserByLogin(db: DB, login: string): Promise<User | undefined> {
  const value = login.trim().toLowerCase();
  if (!value) return undefined;
  const column = value.includes('@') ? users.email : users.username;
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${column}) = ${value}`)
    .limit(1);
  return user;
}

export async function findUserByName(db: DB, name: string): Promise<User | undefined> {
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = ${name.toLowerCase()}`)
    .limit(1);
  return user;
}

export async function findUserById(db: DB, id: string): Promise<User | undefined> {
  const uuid = parseUuid(id);
  if (!uuid) return undefined;
  const [user] = await db.select().from(users).where(eq(users.id, uuid)).limit(1);
  return user;
}

export function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  // drizzle wraps driver errors in DrizzleQueryError with `cause`
  for (let i = 0; i < 3 && e && typeof e === 'object'; i++) {
    if ((e as { code?: string }).code === '23505') return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

export const STATUS_MESSAGES: Record<User['status'], string> = {
  pending_email: 'Сначала подтвердите почту: ссылка в письме.',
  pending_approval: 'Заявка ждёт одобрения администратора.',
  active: '',
  rejected: 'Заявка на регистрацию отклонена.',
  banned: 'Аккаунт заблокирован.',
};

/** Makes the listed nicknames active admins; returns the names that changed. */
export async function promoteAdmins(db: DB, lowercasedNames: string[]): Promise<string[]> {
  if (lowercasedNames.length === 0) return [];
  const rows = await db
    .update(users)
    .set({ isAdmin: true, status: 'active', statusReason: null, approvedAt: sql`coalesce(${users.approvedAt}, now())` })
    .where(
      sql`lower(${users.username}) in (${sql.join(
        lowercasedNames.map((n) => sql`${n}`),
        sql`, `,
      )}) and (${users.isAdmin} = false or ${users.status} <> 'active')`,
    )
    .returning({ username: users.username });
  return rows.map((r) => r.username);
}
