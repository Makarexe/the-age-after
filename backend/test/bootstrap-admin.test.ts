import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { promoteAdmins } from '../src/services/users.js';
import { authenticate, createTestApp, register, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ smtp: true, adminUsernames: ['makar'] });
});
afterAll(() => t.close());

describe('ADMIN_USERNAMES', () => {
  it('parses a list of nicknames', () => {
    const c = loadConfig({ DATABASE_URL: 'x', PUBLIC_URL: 'https://a.test', ADMIN_USERNAMES: ' Makar, Steve;alex ' });
    expect(c.adminUsernames).toEqual(['makar', 'steve', 'alex']);
    expect(loadConfig({ DATABASE_URL: 'x', PUBLIC_URL: 'https://a.test' }).adminUsernames).toEqual([]);
  });

  it('a listed nickname registers straight into an active admin', async () => {
    t.mails.length = 0;
    const res = await register(t.app, 'Makar');
    expect(res.json()).toEqual({ status: 'active', mailSent: false });
    expect(t.mails).toHaveLength(0);
    expect((await authenticate(t.app, 'Makar')).statusCode).toBe(200);
    const admin = await t.app.inject({ method: 'POST', url: '/admin/api/login', payload: { login: 'makar', password: 'password123' } });
    expect(admin.statusCode).toBe(200);
  });

  it('other nicknames still go through email and approval', async () => {
    expect((await register(t.app, 'Steve')).json().status).toBe('pending_email');
  });

  it('promoteAdmins activates existing accounts once', async () => {
    expect(await promoteAdmins(t.db, ['steve'])).toEqual(['Steve']);
    expect(await promoteAdmins(t.db, ['steve', 'makar', 'nobody'])).toEqual([]);
    expect((await authenticate(t.app, 'Steve')).statusCode).toBe(200);
  });
});
