import { createHash, randomBytes } from 'node:crypto';

/** 32 random bytes, URL-safe. Only the sha256 of it is stored. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes(UTF_8)): MD5, version 3, IETF variant. */
export function offlineUuid(name: string): string {
  const md5 = createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
  md5[6] = (md5[6]! & 0x0f) | 0x30;
  md5[8] = (md5[8]! & 0x3f) | 0x80;
  const hex = md5.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function undashed(uuid: string): string {
  return uuid.replace(/-/g, '').toLowerCase();
}

/** Accepts a UUID with or without dashes; returns the dashed lowercase form or null. */
export function parseUuid(input: string): string | null {
  const hex = input.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
