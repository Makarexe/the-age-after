import { createPrivateKey, createPublicKey, createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';

export interface Signer {
  /** PEM (SPKI) for `signaturePublickey` in the API metadata. */
  publicKeyPem: string;
  /** Base64 DER (SPKI) for /minecraftservices/publickeys. */
  publicKeyDerBase64: string;
  /** SHA1withRSA signature of a property value, base64. */
  sign(value: string): string;
}

export function generatePrivateKeyPem(modulusLength = 4096): string {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

export function createSigner(privateKeyPem: string): Signer {
  const privateKey: KeyObject = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== 'rsa') throw new Error('SIGNING_PRIVATE_KEY must be an RSA key');
  const publicKey = createPublicKey(privateKey);
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    publicKeyDerBase64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    sign(value: string) {
      return createSign('RSA-SHA1').update(value, 'utf8').sign(privateKey, 'base64');
    },
  };
}
