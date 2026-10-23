import { and, eq, sql } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import { backstoryImages, users, type BackstoryStatus, type User } from '../db/schema.js';
import { badRequest } from '../lib/errors.js';

export const MAX_IMAGES = 5;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const BLOCK_MESSAGES: Record<BackstoryStatus, string> = {
  none: 'Заполните квенту персонажа в лаунчере: без неё на сервер не пустят.',
  pending: 'Квента ждёт одобрения администратора.',
  approved: '',
  rejected: 'Квента отклонена администратором. Исправьте её в лаунчере.',
};

/** Why this player may not join the server yet; null if they may. Admins are exempt. */
export function playBlock(user: User): string | null {
  if (user.isAdmin || user.backstoryStatus === 'approved') return null;
  const why = user.backstoryStatus === 'rejected' && user.backstoryReview ? ` Причина: ${user.backstoryReview}` : '';
  return BLOCK_MESSAGES[user.backstoryStatus] + why;
}

/** Any change by the player sends a non-empty backstory back to review. */
export async function resubmit(db: DB, user: User): Promise<User> {
  const status: BackstoryStatus = user.backstory.trim() ? 'pending' : 'none';
  if (user.backstoryStatus === status && status !== 'pending') return user;
  const [updated] = await db.update(users).set({ backstoryStatus: status, backstoryReview: null }).where(eq(users.id, user.id)).returning();
  return updated!;
}

/** Type by magic bytes, never by the name or what the client claims. */
export function sniffImage(b: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export async function addImage(db: DB, user: User, base64: string): Promise<void> {
  const data = Buffer.from(base64.replace(/^data:[^,]*;base64,/, ''), 'base64');
  if (data.length > MAX_IMAGE_BYTES) throw badRequest('Изображение больше 2 МБ.');
  const mime = sniffImage(data);
  if (!mime) throw badRequest('Нужен PNG, JPEG или WebP.');
  // shortcut: count-then-insert can overshoot the limit by a parallel upload; fine for a private server.
  if ((await imageList(db, user.id)).length >= MAX_IMAGES) throw badRequest(`Можно прикрепить не больше ${MAX_IMAGES} изображений.`);
  await db.insert(backstoryImages).values({ userId: user.id, mime, data });
}

export async function deleteImage(db: DB, user: User, id: number): Promise<boolean> {
  const rows = await db.delete(backstoryImages).where(and(eq(backstoryImages.id, id), eq(backstoryImages.userId, user.id))).returning({ id: backstoryImages.id });
  return rows.length > 0;
}

export async function imageList(db: DB, userId: string) {
  return db.select({ id: backstoryImages.id, size: sql<number>`length(${backstoryImages.data})` }).from(backstoryImages).where(eq(backstoryImages.userId, userId)).orderBy(backstoryImages.id);
}
