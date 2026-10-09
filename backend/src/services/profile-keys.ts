import { generateKeyPair } from 'node:crypto';
import { promisify } from 'node:util';
import type { Signer } from '../lib/signing.js';

const generateRsa = promisify(generateKeyPair);

const KEY_TTL_MS = 48 * 60 * 60 * 1000;
const REFRESH_AFTER_MS = 36 * 60 * 60 * 1000;

const pem = (label: string, der: Buffer) =>
  `-----BEGIN ${label}-----\n${der.toString('base64').replace(/(.{76})/g, '$1\n')}\n-----END ${label}-----\n`;

/**
 * What the game checks (ProfilePublicKey.Data#signedPayload): profile UUID (most, least
 * significant bits), expiry in epoch millis, then the X.509 (SPKI) bytes of the public key.
 */
export function profileKeyPayload(profileId: string, expiresAtMs: number, publicKeyDer: Buffer): Buffer {
  const hex = profileId.replace(/-/g, '');
  const head = Buffer.alloc(24);
  head.writeBigUInt64BE(BigInt(`0x${hex.slice(0, 16)}`), 0);
  head.writeBigUInt64BE(BigInt(`0x${hex.slice(16, 32)}`), 8);
  head.writeBigInt64BE(BigInt(expiresAtMs), 16);
  return Buffer.concat([head, publicKeyDer]);
}

/**
 * Chat-signing key pair in the shape of api.minecraftservices.com /player/certificates, signed by
 * our key. The MC server trusts it because our /publickeys lists that key under
 * playerCertificateKeys; without this, clients that send a profile key get kicked with
 * "Invalid signature for profile public key".
 */
export async function issueProfileKeyPair(profileId: string, signer: Signer, now = Date.now()) {
  const { publicKey, privateKey } = await generateRsa('rsa', { modulusLength: 2048 });
  const publicDer = publicKey.export({ type: 'spki', format: 'der' });
  const privateDer = privateKey.export({ type: 'pkcs8', format: 'der' });
  const expiresAt = now + KEY_TTL_MS;
  const signature = signer.signBytes(profileKeyPayload(profileId, expiresAt, publicDer));
  return {
    keyPair: {
      privateKey: pem('RSA PRIVATE KEY', privateDer),
      publicKey: pem('RSA PUBLIC KEY', publicDer),
    },
    // 1.19.1+ reads V2; V1 (1.19.0) is not supported, the field is filled for clients that require it.
    publicKeySignature: signature,
    publicKeySignatureV2: signature,
    expiresAt: new Date(expiresAt).toISOString(),
    refreshedAfter: new Date(now + REFRESH_AFTER_MS).toISOString(),
  };
}
