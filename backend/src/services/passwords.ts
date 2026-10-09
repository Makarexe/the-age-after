import { hash, verify } from '@node-rs/argon2';

// Argon2id with the library defaults (m=19 MiB, t=2, p=1), the OWASP baseline.
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

const DUMMY_HASH = hash('timing-equalizer');

export async function verifyPassword(passwordHash: string | undefined, password: string): Promise<boolean> {
  try {
    // Unknown user: still spend the same time hashing.
    return await verify(passwordHash ?? (await DUMMY_HASH), password);
  } catch {
    return false;
  }
}
