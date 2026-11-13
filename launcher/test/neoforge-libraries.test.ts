import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureNeoForgeLibraries, neoForgeNetworkHint } from '../src/main/install/game';
// @ts-expect-error plain JS module without types
import { createZip, } from '../../tools/pack/lib/zip.mjs';
// @ts-expect-error plain JS module without types
import { sha1 } from '../../tools/pack/lib/pack.mjs';

const URL_ = 'https://github.example/neoforge-libraries.zip';
let gameDir: string;
let zip: Buffer;
let requests: string[];

beforeEach(async () => {
  gameDir = await mkdtemp(path.join(tmpdir(), 'nfl-'));
  zip = createZip([{ name: 'libraries/net/neoforged/bus/8.0.5/bus-8.0.5.jar', data: Buffer.from('bus jar') }]);
  requests = [];
});
afterEach(() => rm(gameDir, { recursive: true, force: true }));

const serving = (body: Buffer | null) =>
  (async (url: string | URL | Request) => {
    requests.push(String(url));
    return body ? new Response(new Uint8Array(body)) : Promise.reject(new Error('connect ETIMEDOUT'));
  }) as typeof fetch;

describe('ensureNeoForgeLibraries', () => {
  it('unpacks our archive into libraries/ once', async () => {
    await ensureNeoForgeLibraries(gameDir, { url: URL_, sha1: sha1(zip) }, () => {}, serving(zip));
    expect(await readFile(path.join(gameDir, 'libraries/net/neoforged/bus/8.0.5/bus-8.0.5.jar'), 'utf8')).toBe('bus jar');
    await ensureNeoForgeLibraries(gameDir, { url: URL_, sha1: sha1(zip) }, () => {}, serving(zip));
    expect(requests).toHaveLength(1);
  });

  it('a wrong checksum leaves libraries/ alone and does not throw (the normal download follows)', async () => {
    await expect(ensureNeoForgeLibraries(gameDir, { url: URL_, sha1: 'a'.repeat(40) }, () => {}, serving(zip))).resolves.toBeUndefined();
    await expect(stat(path.join(gameDir, 'libraries'))).rejects.toThrow();
  });

  it('an unreachable archive host does not throw either', async () => {
    await expect(ensureNeoForgeLibraries(gameDir, { url: URL_, sha1: sha1(zip) }, () => {}, serving(null))).resolves.toBeUndefined();
  });
});

describe('neoForgeNetworkHint', () => {
  it('suggests a VPN for timeouts and broken files, not for other errors', () => {
    expect(neoForgeNetworkHint('connect ETIMEDOUT 1.2.3.4:443')).toContain('VPN');
    expect(neoForgeNetworkHint('sha1 checksum not match')).toContain('VPN');
    expect(neoForgeNetworkHint('диск переполнен')).toBe('');
  });
});
