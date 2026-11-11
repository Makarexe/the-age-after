import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticate, createActivePlayer, createAdmin, createTestApp, type TestApp } from './helpers.js';

let t: TestApp;
let token: string;
beforeAll(async () => {
  t = await createTestApp({ smtp: true });
  const adminToken = await createAdmin(t);
  await createActivePlayer(t, adminToken, 'Chatty');
  token = (await authenticate(t.app, 'Chatty')).json().accessToken;
});
afterAll(() => t.close());

describe('player Discord ID', () => {
  it('player sets, validates and clears their own', async () => {
    const put = (discordId: string) => t.app.inject({ method: 'PUT', url: '/launcher/discord', headers: { authorization: `Bearer ${token}` }, payload: { discordId } });
    expect((await put('123456789012345678')).json().discordId).toBe('123456789012345678');
    const me = await t.app.inject({ method: 'GET', url: '/launcher/me', headers: { authorization: `Bearer ${token}` } });
    expect(me.json().discordId).toBe('123456789012345678');
    expect((await put('nick#1234')).statusCode).toBe(400);
    expect((await put('')).json().discordId).toBeNull();
  });
});
