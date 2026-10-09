import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticate, createTestApp, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

describe('rate limits', () => {
  it('authenticate: 10 per minute per IP, then 429 in Yggdrasil format', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await authenticate(t.app, 'Ghost', 'wrong-password')).statusCode).toBe(403);
    }
    const res = await authenticate(t.app, 'Ghost', 'wrong-password');
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ error: 'TooManyRequestsException', errorMessage: expect.any(String) });
  });

  it('other clients are not affected', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/authserver/authenticate',
      remoteAddress: '10.0.0.2',
      payload: { username: 'Ghost', password: 'wrong-password' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('forgot-password: 5 per hour', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await t.app.inject({ method: 'POST', url: '/launcher/forgot-password', payload: { login: 'ghost' } });
      expect(res.statusCode).toBe(204);
    }
    const res = await t.app.inject({ method: 'POST', url: '/launcher/forgot-password', payload: { login: 'ghost' } });
    expect(res.statusCode).toBe(429);
  });
});
