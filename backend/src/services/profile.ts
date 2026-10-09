import type { User } from '../db/schema.js';
import { undashed } from '../lib/crypto.js';
import type { Signer } from '../lib/signing.js';

export interface ProfileProperty {
  name: string;
  value: string;
  signature?: string;
}

export interface GameProfile {
  id: string;
  name: string;
  properties?: ProfileProperty[];
}

export function textureUrl(publicUrl: string, sha256: string): string {
  return `${publicUrl}/textures/${sha256}`;
}

export function shortProfile(user: Pick<User, 'id' | 'username'>): GameProfile {
  return { id: undashed(user.id), name: user.username };
}

export function fullProfile(
  user: Pick<User, 'id' | 'username' | 'skinSha256' | 'skinModel'>,
  opts: { publicUrl: string; signer: Signer; signed: boolean },
): GameProfile {
  const id = undashed(user.id);
  const textures: Record<string, unknown> = {};
  if (user.skinSha256) {
    textures.SKIN = {
      url: textureUrl(opts.publicUrl, user.skinSha256),
      ...(user.skinModel === 'slim' ? { metadata: { model: 'slim' } } : {}),
    };
  }
  const texturesJson = JSON.stringify({
    timestamp: Date.now(),
    profileId: id,
    profileName: user.username,
    textures,
  });
  const properties: ProfileProperty[] = [
    { name: 'textures', value: Buffer.from(texturesJson, 'utf8').toString('base64') },
    { name: 'uploadableTextures', value: 'skin' },
  ];
  if (opts.signed) {
    for (const p of properties) p.signature = opts.signer.sign(p.value);
  }
  return { id, name: user.username, properties };
}
