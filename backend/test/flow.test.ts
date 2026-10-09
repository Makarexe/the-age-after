import { createVerify } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticate, createAdmin, createTestApp, PUBLIC_URL, register, tokenFromMail, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ smtp: true });
});
afterAll(() => t.close());

const STEVE_ID = '5627dd98e6be3c21b8a8e92344183641';

function verifySignature(publicKeyPem: string, value: string, signature: string) {
  return createVerify('RSA-SHA1').update(value, 'utf8').verify(publicKeyPem, signature, 'base64');
}

describe('full account cycle', () => {
  let adminToken: string;
  let accessToken: string;
  let clientToken: string;

  it('serves API metadata', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-authlib-injector-api-location']).toBe('/');
    const meta = res.json();
    expect(meta.meta.serverName).toBe('The Age After');
    expect(meta.meta['feature.non_email_login']).toBe(true);
    expect(meta.skinDomains).toEqual(['auth.example.test']);
    expect(meta.signaturePublickey).toMatch(/^-----BEGIN PUBLIC KEY-----/);
  });

  it('registers → waits for email', async () => {
    adminToken = await createAdmin(t);
    t.mails.length = 0;
    const res = await register(t.app, 'Steve');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ status: 'pending_email', mailSent: true });
    expect(t.mails).toHaveLength(1);
    expect(t.mails[0]!.to).toBe('steve@example.test');
  });

  it('cannot log in before email verification', async () => {
    const res = await authenticate(t.app, 'Steve');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'ForbiddenOperationException', errorMessage: expect.stringContaining('почту') });
  });

  it('verifies email → pending approval, admin is notified', async () => {
    const token = tokenFromMail(t.mails[0], '/verify');
    t.mails.length = 0;
    const res = await t.app.inject({ method: 'GET', url: `/verify?token=${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Почта подтверждена');
    await new Promise((r) => setImmediate(r));
    expect(t.mails.map((m) => m.to)).toContain('admin@example.test');

    const again = await t.app.inject({ method: 'GET', url: `/verify?token=${token}` });
    expect(again.statusCode).toBe(400);

    const login = await authenticate(t.app, 'Steve');
    expect(login.statusCode).toBe(403);
    expect(login.json().errorMessage).toContain('одобрения');
  });

  it('admin approves', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/admin/api/users/${STEVE_ID}/approve`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('active');
  });

  it('authenticates by nickname and by email', async () => {
    const res = await authenticate(t.app, 'steve', 'password123', 'my-client');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.clientToken).toBe('my-client');
    expect(body.selectedProfile).toEqual({ id: STEVE_ID, name: 'Steve' });
    expect(body.availableProfiles).toEqual([{ id: STEVE_ID, name: 'Steve' }]);
    expect(body.user.id).toBe(STEVE_ID);
    accessToken = body.accessToken;
    clientToken = body.clientToken;

    const byEmail = await authenticate(t.app, 'STEVE@example.test');
    expect(byEmail.statusCode).toBe(200);
    expect(byEmail.json().clientToken).toMatch(/^[0-9a-f]{32}$/);
  });

  it('rejects a wrong password with 403', async () => {
    const res = await authenticate(t.app, 'Steve', 'wrong-password');
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('ForbiddenOperationException');
  });

  it('join → hasJoined returns a profile with signed textures', async () => {
    const join = await t.app.inject({
      method: 'POST',
      url: '/sessionserver/session/minecraft/join',
      payload: { accessToken, selectedProfile: STEVE_ID, serverId: 'server-hash-1' },
    });
    expect(join.statusCode).toBe(204);

    const res = await t.app.inject({
      method: 'GET',
      url: '/sessionserver/session/minecraft/hasJoined?username=Steve&serverId=server-hash-1',
    });
    expect(res.statusCode).toBe(200);
    const profile = res.json();
    expect(profile.id).toBe(STEVE_ID);
    expect(profile.name).toBe('Steve');

    const { signaturePublickey } = (await t.app.inject({ method: 'GET', url: '/' })).json();
    const textures = profile.properties.find((p: { name: string }) => p.name === 'textures');
    expect(textures.signature).toBeTruthy();
    expect(verifySignature(signaturePublickey, textures.value, textures.signature)).toBe(true);
    expect(verifySignature(signaturePublickey, textures.value + 'x', textures.signature)).toBe(false);
    const decoded = JSON.parse(Buffer.from(textures.value, 'base64').toString('utf8'));
    expect(decoded).toMatchObject({ profileId: STEVE_ID, profileName: 'Steve', textures: {} });

    const wrongName = await t.app.inject({
      method: 'GET',
      url: '/sessionserver/session/minecraft/hasJoined?username=Alex&serverId=server-hash-1',
    });
    expect(wrongName.statusCode).toBe(204);
    const wrongServer = await t.app.inject({
      method: 'GET',
      url: '/sessionserver/session/minecraft/hasJoined?username=Steve&serverId=other',
    });
    expect(wrongServer.statusCode).toBe(204);
  });

  it('join with a foreign token fails', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/sessionserver/session/minecraft/join',
      payload: { accessToken: 'not-a-token', selectedProfile: STEVE_ID, serverId: 'x' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('publickeys exposes the same key as the metadata', async () => {
    const keys = (await t.app.inject({ method: 'GET', url: '/minecraftservices/publickeys' })).json();
    const { signaturePublickey } = (await t.app.inject({ method: 'GET', url: '/' })).json();
    const der = Buffer.from(
      signaturePublickey.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''),
      'base64',
    ).toString('base64');
    expect(keys.profilePropertyKeys[0].publicKey).toBe(der);
    expect(keys.playerCertificateKeys[0].publicKey).toBe(der);
  });

  it('profile endpoint signs only when unsigned=false', async () => {
    const unsigned = (await t.app.inject({ method: 'GET', url: `/sessionserver/session/minecraft/profile/${STEVE_ID}` })).json();
    expect(unsigned.properties[0].signature).toBeUndefined();
    const signed = (
      await t.app.inject({ method: 'GET', url: `/sessionserver/session/minecraft/profile/${STEVE_ID}?unsigned=false` })
    ).json();
    expect(signed.properties[0].signature).toBeTruthy();
    const missing = await t.app.inject({ method: 'GET', url: '/sessionserver/session/minecraft/profile/00000000000000000000000000000000' });
    expect(missing.statusCode).toBe(204);
  });

  it('name lookups', async () => {
    const bulk = await t.app.inject({ method: 'POST', url: '/api/profiles/minecraft', payload: ['steve', 'Nobody', 'bad name!'] });
    expect(bulk.json()).toEqual([{ id: STEVE_ID, name: 'Steve' }]);
    const services = await t.app.inject({
      method: 'POST',
      url: '/minecraftservices/minecraft/profile/lookup/bulk/byname',
      payload: ['STEVE'],
    });
    expect(services.json()).toEqual([{ id: STEVE_ID, name: 'Steve' }]);
    const one = await t.app.inject({ method: 'GET', url: '/api/users/profiles/minecraft/Steve' });
    expect(one.json()).toEqual({ id: STEVE_ID, name: 'Steve' });
    const single = await t.app.inject({ method: 'GET', url: '/minecraftservices/minecraft/profile/lookup/name/steve' });
    expect(single.json()).toEqual({ id: STEVE_ID, name: 'Steve' });
    const none = await t.app.inject({ method: 'GET', url: '/minecraftservices/minecraft/profile/lookup/name/Nobody' });
    expect(none.statusCode).toBe(404);
  });

  it('refresh → validate → invalidate', async () => {
    const validate = (token: string, ct?: string) =>
      t.app.inject({ method: 'POST', url: '/authserver/validate', payload: { accessToken: token, clientToken: ct } });

    expect((await validate(accessToken, clientToken)).statusCode).toBe(204);
    expect((await validate(accessToken, 'other-client')).statusCode).toBe(403);

    const refresh = await t.app.inject({
      method: 'POST',
      url: '/authserver/refresh',
      payload: { accessToken, clientToken, requestUser: true },
    });
    expect(refresh.statusCode).toBe(200);
    const refreshed = refresh.json();
    expect(refreshed.clientToken).toBe(clientToken);
    expect(refreshed.selectedProfile).toEqual({ id: STEVE_ID, name: 'Steve' });
    expect(refreshed.accessToken).not.toBe(accessToken);

    expect((await validate(accessToken)).statusCode).toBe(403);
    expect((await validate(refreshed.accessToken)).statusCode).toBe(204);

    const inv = await t.app.inject({ method: 'POST', url: '/authserver/invalidate', payload: { accessToken: refreshed.accessToken } });
    expect(inv.statusCode).toBe(204);
    expect((await validate(refreshed.accessToken)).statusCode).toBe(403);
  });

  it('signout revokes every token', async () => {
    const a = (await authenticate(t.app, 'Steve')).json().accessToken;
    const b = (await authenticate(t.app, 'Steve')).json().accessToken;
    const bad = await t.app.inject({ method: 'POST', url: '/authserver/signout', payload: { username: 'Steve', password: 'nope-nope' } });
    expect(bad.statusCode).toBe(403);
    const res = await t.app.inject({ method: 'POST', url: '/authserver/signout', payload: { username: 'Steve', password: 'password123' } });
    expect(res.statusCode).toBe(204);
    for (const token of [a, b]) {
      const v = await t.app.inject({ method: 'POST', url: '/authserver/validate', payload: { accessToken: token } });
      expect(v.statusCode).toBe(403);
    }
  });

  it('launcher config', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/launcher/config' });
    expect(res.json()).toEqual({
      serverName: 'The Age After',
      serverAddress: 'play.example.test',
      packManifestUrl: 'https://example.test/manifest.json',
      apiRoot: PUBLIC_URL,
    });
  });
});
