// Usage (Railway shell): node dist/scripts/make-admin.js <ник>
import { eq } from 'drizzle-orm';
import { connectPostgres } from '../db/index.js';
import { users } from '../db/schema.js';
import { findUserByName } from '../services/users.js';

const name = process.argv[2];
if (!name) {
  console.error('Использование: node dist/scripts/make-admin.js <ник>');
  process.exit(1);
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL не задан');
  process.exit(1);
}

const { db, close } = await connectPostgres(databaseUrl);
try {
  const user = await findUserByName(db, name);
  if (!user) {
    console.error(`Игрок «${name}» не найден. Сначала зарегистрируйтесь через лаунчер.`);
    process.exitCode = 1;
  } else {
    await db
      .update(users)
      .set({ isAdmin: true, status: 'active', statusReason: null, approvedAt: user.approvedAt ?? new Date() })
      .where(eq(users.id, user.id));
    console.log(`${user.username} теперь администратор (статус: active).`);
  }
} finally {
  await close();
}
