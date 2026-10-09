import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient } from '../src/main/api';
import { UserError } from '../src/main/errors';
import { SessionStore, type SecretBox } from '../src/main/session';
import { clampMemory, defaultMemoryMb, SettingsStore } from '../src/main/settings';

const box: SecretBox = {
  available: () => true,
  encrypt: (s) => Buffer.from(s).reverse().toString('base64'),
  decrypt: (s) => Buffer.from(s, 'base64').reverse().toString(),
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'session-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('SessionStore', () => {
  it('keeps the client token across logins and never stores the token in clear text', async () => {
    const file = path.join(dir, 'session.json');
    const s = new SessionStore(file, box);
    const clientToken = s.clientToken;
    expect(s.profile).toBeNull();
    s.set('secret-access-token', { id: 'abc', name: 'Steve' });
    expect(await readFile(file, 'utf8')).not.toContain('secret-access-token');

    const reloaded = new SessionStore(file, box);
    expect(reloaded.clientToken).toBe(clientToken);
    expect(reloaded.accessToken).toBe('secret-access-token');
    expect(reloaded.profile).toEqual({ id: 'abc', name: 'Steve' });

    reloaded.clear();
    expect(new SessionStore(file, box).profile).toBeNull();
    expect(new SessionStore(file, box).clientToken).toBe(clientToken);
  });

  it('a token that cannot be decrypted means "not logged in"', () => {
    const file = path.join(dir, 'session.json');
    new SessionStore(file, box).set('t', { id: 'a', name: 'b' });
    const broken = new SessionStore(file, { ...box, decrypt: () => { throw new Error('other user'); } });
    expect(broken.profile).toBeNull();
  });
});

describe('settings', () => {
  it('memory defaults and limits', () => {
    expect(defaultMemoryMb(8192)).toBe(4096);
    expect(defaultMemoryMb(16384)).toBe(8192);
    expect(defaultMemoryMb(65536)).toBe(8192);
    expect(clampMemory(100, 16384)).toBe(2048);
    expect(clampMemory(64000, 16384)).toBe(16384 - 1536);
  });

  it('validates the account server address', () => {
    const store = new SettingsStore(path.join(dir, 'settings.json'), 'C:/game');
    expect(store.update({ apiRoot: 'https://auth.example.com/ ' }).apiRoot).toBe('https://auth.example.com');
    expect(() => store.update({ apiRoot: 'auth.example.com' })).toThrow();
    expect(new SettingsStore(path.join(dir, 'settings.json'), 'C:/game').get().apiRoot).toBe('https://auth.example.com');
  });
});

describe('ApiClient', () => {
  const client = (status: number, body: unknown) =>
    new ApiClient(() => 'https://auth.example.com', '0.1.0', (async () =>
      new Response(body === undefined ? null : JSON.stringify(body), { status })) as typeof fetch);

  it('passes the server message through', async () => {
    const err = await client(403, { error: 'ForbiddenOperationException', errorMessage: 'Заявка ждёт одобрения администратора.' })
      .authenticate('a', 'b', 'c')
      .catch((e) => e);
    expect(err).toBeInstanceOf(UserError);
    expect(err.message).toBe('Заявка ждёт одобрения администратора.');
  });

  it('401 means the session expired', async () => {
    const err = await client(401, { error: 'Unauthorized', errorMessage: 'x' }).me('t').catch((e) => e);
    expect(err.code).toBe('session_expired');
  });

  it('refresh returns null for a dead token', async () => {
    expect(await client(403, { error: 'ForbiddenOperationException', errorMessage: 'Invalid token.' }).refresh('a', 'b')).toBeNull();
  });

  it('network failure becomes a readable error', async () => {
    const api = new ApiClient(() => 'https://auth.example.com', '0.1.0', (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch);
    await expect(api.news()).rejects.toThrow(/Не удалось связаться/);
  });
});
