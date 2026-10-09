import { fileURLToPath } from 'node:url';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema.js';

export { schema };
export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Same relative location from src/db (tsx, vitest) and dist/db (node). */
export const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

export async function connectPostgres(databaseUrl: string): Promise<{ db: DB; close: () => Promise<void> }> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder });
  return { db, close: () => pool.end() };
}
