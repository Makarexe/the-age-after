import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationsFolder, schema, type DB } from '../src/db/index.js';
import { createSigner, generatePrivateKeyPem } from '../src/lib/signing.js';
import { loadOrCreateSigningKey } from '../src/services/secrets.js';

let client: PGlite;
let db: DB;
beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as DB;
  await migrate(drizzle(client, { schema }), { migrationsFolder });
});
afterAll(() => client.close());

describe('loadOrCreateSigningKey', () => {
  it('generates the key once and then keeps returning it', async () => {
    let generated = 0;
    const generate = () => {
      generated++;
      return generatePrivateKeyPem(2048);
    };
    const first = await loadOrCreateSigningKey(db, generate);
    expect(first.created).toBe(true);
    expect(() => createSigner(first.pem)).not.toThrow();

    const second = await loadOrCreateSigningKey(db, generate);
    expect(second).toEqual({ pem: first.pem, created: false });
    expect(generated).toBe(1);
  });
});
