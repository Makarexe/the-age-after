import { crc32, deflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  authenticate,
  createActivePlayer,
  createAdmin,
  createTestApp,
  PUBLIC_URL,
  register,
  tokenFromMail,
  type TestApp,
} from './helpers.js';

function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let t: TestApp;
let adminToken: string;
beforeAll(async () => {
  t = await createTestApp({ smtp: true });
  adminToken = await createAdmin(t);
});
afterAll(() => t.close());

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe('registration validation', () => {
  it('rejects bad nicknames, emails and short passwords', async () => {
    for (const [payload, text] of [
      [{ username: 'ab', email: 'a@b.cd', password: 'password123' }, 'Ник'],
      [{ username: 'bad name', email: 'a@b.cd', password: 'password123' }, 'Ник'],
      [{ username: 'Кирилл', email: 'a@b.cd', password: 'password123' }, 'Ник'],
      [{ username: 'Good_1', email: 'not-an-email', password: 'password123' }, 'почты'],
      [{ username: 'Good_1', email: 'a@b.cd', password: 'short' }, '8'],
    ] as const) {
      const res = await t.app.inject({ method: 'POST', url: '/launcher/register', payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json().errorMessage).toContain(text);
    }
  });

  it('nickname and email are unique case-insensitively', async () => {
    expect((await register(t.app, 'Alex')).statusCode).toBe(201);
    const sameNick = await register(t.app, 'ALEX', 'password123', 'other@example.test');
    expect(sameNick.statusCode).toBe(409);
    expect(sameNick.json().errorMessage).toContain('ник');
    const sameEmail = await register(t.app, 'Alex2', 'password123', 'ALEX@example.test');
    expect(sameEmail.statusCode).toBe(409);
    expect(sameEmail.json().errorMessage).toContain('почта');
  });

  it('resend-verification sends a new link, unknown login is silent', async () => {
    t.mails.length = 0;
    const res = await t.app.inject({ method: 'POST', url: '/launcher/resend-verification', payload: { login: 'alex' } });
    expect(res.statusCode).toBe(204);
    expect(t.mails).toHaveLength(1);
    const unknown = await t.app.inject({ method: 'POST', url: '/launcher/resend-verification', payload: { login: 'nobody' } });
    expect(unknown.statusCode).toBe(204);
    expect(t.mails).toHaveLength(1);
  });
});

describe('password reset and change', () => {
  it('forgot → reset form → new password works, old tokens die', async () => {
    await createActivePlayer(t, adminToken, 'Resetter', 'oldpassword');
    const oldToken = (await authenticate(t.app, 'Resetter', 'oldpassword')).json().accessToken;

    t.mails.length = 0;
    const forgot = await t.app.inject({ method: 'POST', url: '/launcher/forgot-password', payload: { login: 'resetter@example.test' } });
    expect(forgot.statusCode).toBe(204);
    const token = tokenFromMail(t.mails[0], '/reset');

    const form = await t.app.inject({ method: 'GET', url: `/reset?token=${token}` });
    expect(form.statusCode).toBe(200);
    expect(form.body).toContain('<form');

    const mismatch = await t.app.inject({
      method: 'POST',
      url: '/reset',
      payload: `token=${token}&password=newpassword1&password2=different1`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.body).toContain('не совпадают');

    const ok = await t.app.inject({
      method: 'POST',
      url: '/reset',
      payload: `token=${token}&password=newpassword1&password2=newpassword1`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toContain('Пароль изменён');

    expect((await authenticate(t.app, 'Resetter', 'oldpassword')).statusCode).toBe(403);
    expect((await authenticate(t.app, 'Resetter', 'newpassword1')).statusCode).toBe(200);
    const v = await t.app.inject({ method: 'POST', url: '/authserver/validate', payload: { accessToken: oldToken } });
    expect(v.statusCode).toBe(403);

    const reuse = await t.app.inject({ method: 'POST', url: '/launcher/reset-password', payload: { token, password: 'another123' } });
    expect(reuse.statusCode).toBe(400);
  });

  it('change-password keeps the current session and kills the others', async () => {
    await createActivePlayer(t, adminToken, 'Changer', 'oldpassword');
    const current = (await authenticate(t.app, 'Changer', 'oldpassword')).json().accessToken;
    const other = (await authenticate(t.app, 'Changer', 'oldpassword')).json().accessToken;

    const wrong = await t.app.inject({
      method: 'POST',
      url: '/launcher/change-password',
      headers: auth(current),
      payload: { oldPassword: 'nope', newPassword: 'newpassword1' },
    });
    expect(wrong.statusCode).toBe(403);

    const res = await t.app.inject({
      method: 'POST',
      url: '/launcher/change-password',
      headers: auth(current),
      payload: { oldPassword: 'oldpassword', newPassword: 'newpassword1' },
    });
    expect(res.statusCode).toBe(204);
    expect((await t.app.inject({ method: 'GET', url: '/launcher/me', headers: auth(current) })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: '/launcher/me', headers: auth(other) })).statusCode).toBe(401);
  });
});

describe('me, skins, news', () => {
  let token: string;
  let id: string;

  beforeAll(async () => {
    await createActivePlayer(t, adminToken, 'Skinner');
    const body = (await authenticate(t.app, 'Skinner')).json();
    token = body.accessToken;
    id = body.selectedProfile.id;
  });

  it('me requires a token', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/launcher/me' })).statusCode).toBe(401);
    const me = (await t.app.inject({ method: 'GET', url: '/launcher/me', headers: auth(token) })).json();
    expect(me).toMatchObject({ id, username: 'Skinner', email: 'skinner@example.test', status: 'active', isAdmin: false, skin: null });
  });

  it('rejects non-PNG and wrong sizes', async () => {
    const notPng = await t.app.inject({
      method: 'POST',
      url: '/launcher/skin',
      headers: auth(token),
      payload: { png: Buffer.from('hello').toString('base64'), model: 'classic' },
    });
    expect(notPng.statusCode).toBe(400);
    const wrongSize = await t.app.inject({
      method: 'POST',
      url: '/launcher/skin',
      headers: auth(token),
      payload: { png: png(128, 128).toString('base64'), model: 'classic' },
    });
    expect(wrongSize.statusCode).toBe(400);
    expect(wrongSize.json().errorMessage).toContain('64×64');
  });

  it('uploads a slim skin; it shows up in the signed profile and is served', async () => {
    const file = png(64, 64);
    const res = await t.app.inject({
      method: 'POST',
      url: '/launcher/skin',
      headers: auth(token),
      payload: { png: file.toString('base64'), model: 'slim' },
    });
    expect(res.statusCode).toBe(200);
    const skin = res.json().skin;
    expect(skin.model).toBe('slim');
    expect(skin.url).toMatch(new RegExp(`^${PUBLIC_URL}/textures/[0-9a-f]{64}$`));

    const profile = (
      await t.app.inject({ method: 'GET', url: `/sessionserver/session/minecraft/profile/${id}?unsigned=false` })
    ).json();
    const textures = JSON.parse(Buffer.from(profile.properties[0].value, 'base64').toString());
    expect(textures.textures.SKIN).toEqual({ url: skin.url, metadata: { model: 'slim' } });

    const served = await t.app.inject({ method: 'GET', url: new URL(skin.url).pathname });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.rawPayload.equals(file)).toBe(true);

    const legacy = await t.app.inject({
      method: 'POST',
      url: '/launcher/skin',
      headers: auth(token),
      payload: { png: png(64, 32).toString('base64') },
    });
    expect(legacy.json().skin.model).toBe('classic');

    const modelOnly = await t.app.inject({ method: 'POST', url: '/launcher/skin', headers: auth(token), payload: { model: 'slim' } });
    expect(modelOnly.json().skin).toEqual({ url: legacy.json().skin.url, model: 'slim' });

    const removed = await t.app.inject({ method: 'DELETE', url: '/launcher/skin', headers: auth(token) });
    expect(removed.json().skin).toBeNull();
    const noSkin = await t.app.inject({ method: 'POST', url: '/launcher/skin', headers: auth(token), payload: { model: 'slim' } });
    expect(noSkin.statusCode).toBe(400);
  });

  it('news appear in the launcher feed, newest first', async () => {
    for (const title of ['Первая', 'Вторая']) {
      const res = await t.app.inject({
        method: 'POST',
        url: '/admin/api/news',
        headers: auth(adminToken),
        payload: { title, body: `Текст: ${title}` },
      });
      expect(res.statusCode).toBe(201);
    }
    const feed = (await t.app.inject({ method: 'GET', url: '/launcher/news' })).json();
    expect(feed.map((n: { title: string }) => n.title)).toEqual(['Вторая', 'Первая']);
    expect(feed[0]).toMatchObject({ body: 'Текст: Вторая', createdAt: expect.any(String) });

    const del = await t.app.inject({ method: 'DELETE', url: `/admin/api/news/${feed[0].id}`, headers: auth(adminToken) });
    expect(del.statusCode).toBe(204);
    expect((await t.app.inject({ method: 'GET', url: '/launcher/news' })).json()).toHaveLength(1);
  });
});
