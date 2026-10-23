import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticate, createActivePlayer, createAdmin, createTestApp, type TestApp } from './helpers.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]).toString('base64');
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).toString('base64');

let t: TestApp;
let adminToken: string;
let token: string;
let id: string;
const auth = (tk: string) => ({ authorization: `Bearer ${tk}` });
const join = (serverId: string) =>
  t.app.inject({ method: 'POST', url: '/sessionserver/session/minecraft/join', payload: { accessToken: token, selectedProfile: id, serverId } });

beforeAll(async () => {
  t = await createTestApp({ smtp: true });
  adminToken = await createAdmin(t);
  await createActivePlayer(t, adminToken, 'Hero');
  const res = (await authenticate(t.app, 'Hero')).json();
  token = res.accessToken;
  id = res.selectedProfile.id;
});
afterAll(() => t.close());

describe('backstory approval', () => {
  it('rejection carries a reason; editing after approval sends it back to review', async () => {
    await t.app.inject({ method: 'PUT', url: '/launcher/backstory', headers: auth(token), payload: { backstory: 'v1' } });
    const noReason = await t.app.inject({ method: 'POST', url: `/admin/api/users/${id}/backstory-review`, headers: auth(adminToken), payload: { decision: 'reject' } });
    expect(noReason.statusCode).toBe(400);

    await t.app.inject({ method: 'POST', url: `/admin/api/users/${id}/backstory-review`, headers: auth(adminToken), payload: { decision: 'reject', reason: 'мало текста' } });
    expect((await join('s1')).json().errorMessage).toContain('мало текста');

    await t.app.inject({ method: 'POST', url: `/admin/api/users/${id}/backstory-review`, headers: auth(adminToken), payload: { decision: 'approve' } });
    expect((await join('s2')).statusCode).toBe(204);
    const hj = await t.app.inject({ method: 'GET', url: '/sessionserver/session/minecraft/hasJoined?username=Hero&serverId=s2' });
    expect(hj.statusCode).toBe(200);

    const edit = await t.app.inject({ method: 'PUT', url: '/launcher/backstory', headers: auth(token), payload: { backstory: 'v2' } });
    expect(edit.json().backstoryStatus).toBe('pending');
    expect((await join('s3')).statusCode).toBe(403);
    await t.app.inject({ method: 'POST', url: `/admin/api/users/${id}/backstory-review`, headers: auth(adminToken), payload: { decision: 'approve' } });
    // Saving the same text changes nothing.
    const same = await t.app.inject({ method: 'PUT', url: '/launcher/backstory', headers: auth(token), payload: { backstory: 'v2' } });
    expect(same.json().backstoryStatus).toBe('approved');
  });

  it('hasJoined refuses a join made before the backstory was pulled back', async () => {
    expect((await join('s4')).statusCode).toBe(204);
    await t.app.inject({ method: 'PUT', url: '/launcher/backstory', headers: auth(token), payload: { backstory: 'v3' } });
    const hj = await t.app.inject({ method: 'GET', url: '/sessionserver/session/minecraft/hasJoined?username=Hero&serverId=s4' });
    expect(hj.statusCode).toBe(204);
  });

  it('images: type by content, size and count limits, admin can fetch', async () => {
    const post = (data: string) => t.app.inject({ method: 'POST', url: '/launcher/backstory/images', headers: auth(token), payload: { data } });
    const bad = await post(Buffer.from('<svg onload=alert(1)>').toString('base64'));
    expect(bad.statusCode).toBe(400);
    expect((await post(Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(2 * 1024 * 1024)]).toString('base64'))).statusCode).toBe(400);

    const first = (await post(PNG)).json();
    expect(first.backstoryImages).toHaveLength(1);
    expect(first.backstoryStatus).toBe('pending');
    for (let i = 0; i < 4; i++) expect((await post(JPG)).statusCode).toBe(200);
    expect((await post(JPG)).statusCode).toBe(400);

    const imgId = first.backstoryImages[0].id;
    const asPlayer = await t.app.inject({ method: 'GET', url: `/admin/api/images/${imgId}`, headers: auth(token) });
    expect(asPlayer.statusCode).toBe(403);
    const asAdmin = await t.app.inject({ method: 'GET', url: `/admin/api/images/${imgId}`, headers: auth(adminToken) });
    expect(asAdmin.headers['content-type']).toBe('image/png');
    expect(asAdmin.headers['x-content-type-options']).toBe('nosniff');

    const users = (await t.app.inject({ method: 'GET', url: '/admin/api/users', headers: auth(adminToken) })).json();
    expect(users.find((u: { id: string }) => u.id === id).images).toHaveLength(5);

    const del = await t.app.inject({ method: 'DELETE', url: `/launcher/backstory/images/${imgId}`, headers: auth(token) });
    expect(del.json().backstoryImages).toHaveLength(4);
    expect((await t.app.inject({ method: 'DELETE', url: `/launcher/backstory/images/${imgId}`, headers: auth(token) })).statusCode).toBe(404);
  });
});
