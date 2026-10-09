import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticate, createActivePlayer, createAdmin, createTestApp, register, type TestApp } from './helpers.js';

let t: TestApp;
let adminToken: string;
beforeAll(async () => {
  // No SMTP: registration skips email verification.
  t = await createTestApp({ smtp: false });
  adminToken = await createAdmin(t);
});
afterAll(() => t.close());

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const users = async () => (await t.app.inject({ method: 'GET', url: '/admin/api/users', headers: auth(adminToken) })).json();
const byName = async (name: string) => (await users()).find((u: { username: string }) => u.username === name);
const act = (id: string, action: string, payload: object = {}) =>
  t.app.inject({ method: 'POST', url: `/admin/api/users/${id}/${action}`, headers: auth(adminToken), payload });

describe('admin panel', () => {
  it('serves the HTML page', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/admin' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Вход в админку');
  });

  it('without SMTP registration goes straight to approval', async () => {
    const res = await register(t.app, 'NoMail');
    expect(res.json()).toEqual({ status: 'pending_approval', mailSent: false });
  });

  it('non-admins and anonymous users are refused', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/admin/api/users' })).statusCode).toBe(401);
    await createActivePlayer(t, adminToken, 'Player');
    const login = await t.app.inject({ method: 'POST', url: '/admin/api/login', payload: { login: 'Player', password: 'password123' } });
    expect(login.statusCode).toBe(403);
    const playerToken = (await authenticate(t.app, 'Player')).json().accessToken;
    const res = await t.app.inject({ method: 'GET', url: '/admin/api/users', headers: auth(playerToken) });
    expect(res.statusCode).toBe(403);
  });

  it('ban kills sessions and blocks login; unban restores', async () => {
    const player = await byName('Player');
    const token = (await authenticate(t.app, 'Player')).json().accessToken;

    const ban = await act(player.id, 'ban', { reason: 'гриф' });
    expect(ban.json()).toMatchObject({ status: 'banned', statusReason: 'гриф' });
    const v = await t.app.inject({ method: 'POST', url: '/authserver/validate', payload: { accessToken: token } });
    expect(v.statusCode).toBe(403);
    const login = await authenticate(t.app, 'Player');
    expect(login.statusCode).toBe(403);
    expect(login.json().errorMessage).toContain('заблокирован');
    const hasJoined = await t.app.inject({ method: 'GET', url: `/sessionserver/session/minecraft/profile/${player.id}` });
    expect(hasJoined.statusCode).toBe(204);

    expect((await act(player.id, 'ban')).statusCode).toBe(400);
    expect((await act(player.id, 'unban')).json().status).toBe('active');
    expect((await authenticate(t.app, 'Player')).statusCode).toBe(200);
  });

  it('reject and delete free the nickname', async () => {
    const user = await byName('NoMail');
    expect((await act(user.id, 'reject', { reason: 'не знаем' })).json().status).toBe('rejected');
    expect((await authenticate(t.app, 'NoMail')).json().errorMessage).toContain('отклонена');
    expect((await act(user.id, 'delete')).json()).toEqual({ deleted: true });
    expect(await byName('NoMail')).toBeUndefined();
    expect((await register(t.app, 'NoMail')).statusCode).toBe(201);
  });

  it('admin cannot act on themselves; unknown actions 404', async () => {
    const me = await byName('Admin');
    expect((await act(me.id, 'ban')).statusCode).toBe(400);
    expect((await act(me.id, 'promote')).statusCode).toBe(404);
    expect((await act(me.id, 'toString')).statusCode).toBe(404);
  });

  it('every action lands in the audit log', async () => {
    const log = (await t.app.inject({ method: 'GET', url: '/admin/api/audit', headers: auth(adminToken) })).json();
    const actions = log.map((r: { action: string }) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['approve', 'ban', 'unban', 'reject', 'delete']));
    const ban = log.find((r: { action: string }) => r.action === 'ban');
    expect(ban).toMatchObject({ admin: 'Admin', details: { username: 'Player', reason: 'гриф' } });
  });

  it('logout revokes the admin token', async () => {
    const token = (await t.app.inject({ method: 'POST', url: '/admin/api/login', payload: { login: 'admin', password: 'adminpass123' } })).json().token;
    expect((await t.app.inject({ method: 'POST', url: '/admin/api/logout', headers: auth(token) })).statusCode).toBe(204);
    expect((await t.app.inject({ method: 'GET', url: '/admin/api/me', headers: auth(token) })).statusCode).toBe(401);
  });
});
