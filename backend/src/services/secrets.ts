import { eq } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import { appSecrets } from '../db/schema.js';
import { generatePrivateKeyPem } from '../lib/signing.js';

const SIGNING_KEY = 'signing_private_key';

/**
 * The texture signing key when SIGNING_PRIVATE_KEY is not set: generated once and kept in the
 * database, so it survives restarts and redeploys (a changing key breaks skins until the MC
 * server restarts).
 */
export async function loadOrCreateSigningKey(
  db: DB,
  generate: () => string = () => generatePrivateKeyPem(4096),
): Promise<{ pem: string; created: boolean }> {
  const read = async () =>
    (await db.select({ value: appSecrets.value }).from(appSecrets).where(eq(appSecrets.name, SIGNING_KEY)).limit(1))[0]
      ?.value;
  const existing = await read();
  if (existing) return { pem: existing, created: false };
  const inserted = await db
    .insert(appSecrets)
    .values({ name: SIGNING_KEY, value: generate() })
    .onConflictDoNothing()
    .returning({ value: appSecrets.value });
  // Another replica may have won the race: use whatever is stored.
  if (inserted[0]) return { pem: inserted[0].value, created: true };
  return { pem: (await read())!, created: false };
}
