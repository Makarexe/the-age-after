import { createPrivateKey, createPublicKey, createSign, createVerify } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { profileKeyPayload } from '../src/services/profile-keys.js';
import { authenticate, createActivePlayer, createAdmin, createTestApp, type TestApp } from './helpers.js';

let t: TestApp;
let token: string;
let profileId: string;
beforeAll(async () => {
  t = await createTestApp();
  const admin = await createAdmin(t);
  await createActivePlayer(t, admin, 'Makarkrut');
  const auth = (await authenticate(t.app, 'Makarkrut')).json();
  token = auth.accessToken;
  profileId = auth.selectedProfile.id;
});
afterAll(() => t.close());

/** Like Crypt.rsaStringToKey in the game: drop the header/footer, MIME-base64 decode the rest. */
function pemBody(pem: string, label: string): Buffer {
  return Buffer.from(pem.replace(`-----BEGIN ${label}-----`, '').replace(`-----END ${label}-----`, '').replace(/\s+/g, ''), 'base64');
}

describe('/minecraftservices/player/certificates', () => {
  it('needs a valid token', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/minecraftservices/player/certificates' });
    expect(res.statusCode).toBe(403);
  });

  it('issues a key pair whose signature the MC server accepts', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/minecraftservices/player/certificates',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.keyPair.privateKey).toMatch(/^-----BEGIN RSA PRIVATE KEY-----\n/);
    expect(body.keyPair.publicKey).toMatch(/^-----BEGIN RSA PUBLIC KEY-----\n/);
    const expiresAt = Date.parse(body.expiresAt);
    expect(expiresAt).toBeGreaterThan(Date.now() + 47 * 3600_000);
    expect(Date.parse(body.refreshedAfter)).toBeLessThan(expiresAt);

    // The MC server: playerCertificateKeys from our /publickeys, SHA1withRSA over the payload.
    const keys = (await t.app.inject({ method: 'GET', url: '/minecraftservices/publickeys' })).json();
    const certKey = createPublicKey({ key: Buffer.from(keys.playerCertificateKeys[0].publicKey, 'base64'), format: 'der', type: 'spki' });
    const publicDer = pemBody(body.keyPair.publicKey, 'RSA PUBLIC KEY');
    const payload = profileKeyPayload(profileId, expiresAt, publicDer);
    const signature = Buffer.from(body.publicKeySignatureV2, 'base64');
    expect(createVerify('RSA-SHA1').update(payload).verify(certKey, signature)).toBe(true);
    // Another profile id must not validate.
    const other = profileKeyPayload('00000000000000000000000000000001', expiresAt, publicDer);
    expect(createVerify('RSA-SHA1').update(other).verify(certKey, signature)).toBe(false);

    // The client signs chat with the private key; the server checks with the public key.
    const priv = createPrivateKey({ key: pemBody(body.keyPair.privateKey, 'RSA PRIVATE KEY'), format: 'der', type: 'pkcs8' });
    const pub = createPublicKey({ key: publicDer, format: 'der', type: 'spki' });
    const chatSig = createSign('RSA-SHA256').update('привет').sign(priv);
    expect(createVerify('RSA-SHA256').update('привет').verify(pub, chatSig)).toBe(true);
  });

  it('metadata advertises profile keys', async () => {
    const meta = (await t.app.inject({ method: 'GET', url: '/' })).json();
    expect(meta.meta['feature.enable_profile_key']).toBe(true);
  });

  it('payload layout matches ProfilePublicKey.Data#signedPayload', () => {
    const p = profileKeyPayload('b50ad385-829d-3141-a216-7e7d7539ba7f', 0x010203040506, Buffer.from([0xaa]));
    expect(p.toString('hex')).toBe('b50ad385829d3141' + 'a2167e7d7539ba7f' + '0000010203040506' + 'aa');
  });
});
