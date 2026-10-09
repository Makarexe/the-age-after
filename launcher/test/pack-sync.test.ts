import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isSafeRelativePath, syncPack, validateManifest, type PackManifest } from '../src/main/install/pack';
// The real pack builder: the launcher must understand exactly what tools/pack produces.
// @ts-expect-error plain JS module without types
import { buildPack, sha1 } from '../../tools/pack/lib/pack.mjs';

const RELEASE = 'https://github.com/o/r/releases/download/pack-latest';

let root: string;
let instance: string;
let gameDir: string;
let served: Map<string, Buffer>;
let requests: string[];

const fakeFetch = (async (input: string | URL | Request) => {
  const url = String(input).replace(/[?&]t=\d+$/, '');
  requests.push(url);
  const body = served.get(url);
  if (!body) return new Response('not found', { status: 404 });
  return new Response(new Uint8Array(body), { status: 200 });
}) as typeof fetch;

async function publish(packVersion: string): Promise<PackManifest> {
  const { manifest, uploads } = await buildPack({
    instanceDir: instance,
    config: {
      minecraft: '1.21.1',
      neoforge: '21.1.256',
      overrideDirs: ['config'],
      overrideFiles: ['options.txt'],
      firstInstallOnly: ['options.txt'],
      managedDirs: ['mods'],
      exclude: [],
    },
    sides: { serverOnly: [], clientOnly: [] },
    releaseBaseUrl: RELEASE,
    packVersion,
  });
  for (const u of uploads as { name: string; data: Buffer }[]) served.set(`${RELEASE}/${u.name}`, u.data);
  return validateManifest(JSON.parse(JSON.stringify(manifest)));
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'launcher-'));
  instance = path.join(root, 'instance');
  gameDir = path.join(root, 'game');
  served = new Map();
  requests = [];
  const cfMod = Buffer.from('curseforge mod bytes');
  served.set('https://edge.forgecdn.net/files/1/2/cf.jar', cfMod);
  await mkdir(path.join(instance, 'mods'), { recursive: true });
  await mkdir(path.join(instance, 'config', 'sub'), { recursive: true });
  await writeFile(
    path.join(instance, 'minecraftinstance.json'),
    JSON.stringify({
      installedAddons: [
        {
          name: 'CF Mod',
          installedFile: {
            fileNameOnDisk: 'cf.jar',
            downloadUrl: 'https://edge.forgecdn.net/files/1/2/cf.jar',
            hashes: [{ type: 1, value: sha1(cfMod) }],
          },
          categorySection: { path: 'mods' },
        },
      ],
    }),
  );
  await writeFile(path.join(instance, 'mods', 'cf.jar'), cfMod);
  await writeFile(path.join(instance, 'mods', 'own.jar'), 'own mod v1');
  await writeFile(path.join(instance, 'config', 'a.toml'), 'a=1');
  await writeFile(path.join(instance, 'config', 'sub', 'b.json'), '{"b":1}');
  await writeFile(path.join(instance, 'options.txt'), 'owner options');
});

afterEach(() => rm(root, { recursive: true, force: true }));

describe('syncPack against tools/pack output', () => {
  it('first install: downloads mods, applies configs and options.txt', async () => {
    const manifest = await publish('2026.10.09-1');
    const result = await syncPack({ gameDir, manifest, fetchImpl: fakeFetch });
    expect(result.downloaded.sort()).toEqual(['mods/cf.jar', 'mods/own.jar']);
    expect(result.overridesApplied).toBe(true);
    expect(await readFile(path.join(gameDir, 'mods', 'own.jar'), 'utf8')).toBe('own mod v1');
    expect(await readFile(path.join(gameDir, 'config', 'sub', 'b.json'), 'utf8')).toBe('{"b":1}');
    expect(await readFile(path.join(gameDir, 'options.txt'), 'utf8')).toBe('owner options');
  });

  it('second run with the same pack downloads nothing', async () => {
    const manifest = await publish('2026.10.09-1');
    await syncPack({ gameDir, manifest, fetchImpl: fakeFetch });
    requests = [];
    const again = await syncPack({ gameDir, manifest, fetchImpl: fakeFetch });
    expect(again).toEqual({ downloaded: [], removed: [], overridesApplied: false });
    expect(requests).toEqual([]);
  });

  it('pack update: replaces changed mods, removes extras, keeps the player options.txt', async () => {
    await syncPack({ gameDir, manifest: await publish('2026.10.09-1'), fetchImpl: fakeFetch });
    await writeFile(path.join(gameDir, 'options.txt'), 'player options');
    await writeFile(path.join(gameDir, 'mods', 'random-client-mod.jar'), 'x');
    await mkdir(path.join(gameDir, 'mods', 'mod-data'), { recursive: true });
    await writeFile(path.join(gameDir, 'config', 'a.toml'), 'player edited');

    await writeFile(path.join(instance, 'mods', 'own.jar'), 'own mod v2');
    await writeFile(path.join(instance, 'config', 'a.toml'), 'a=2');
    const result = await syncPack({ gameDir, manifest: await publish('2026.10.09-2'), fetchImpl: fakeFetch });

    expect(result.downloaded).toEqual(['mods/own.jar']);
    expect(result.removed).toEqual(['mods/random-client-mod.jar']);
    expect(await readFile(path.join(gameDir, 'mods', 'own.jar'), 'utf8')).toBe('own mod v2');
    expect(await readFile(path.join(gameDir, 'config', 'a.toml'), 'utf8')).toBe('a=2');
    expect(await readFile(path.join(gameDir, 'options.txt'), 'utf8')).toBe('player options');
    expect((await stat(path.join(gameDir, 'mods', 'mod-data'))).isDirectory()).toBe(true);
  });

  it('a corrupted local mod is re-downloaded', async () => {
    const manifest = await publish('2026.10.09-1');
    await syncPack({ gameDir, manifest, fetchImpl: fakeFetch });
    await writeFile(path.join(gameDir, 'mods', 'cf.jar'), 'broken!');
    const result = await syncPack({ gameDir, manifest, fetchImpl: fakeFetch });
    expect(result.downloaded).toEqual(['mods/cf.jar']);
  });

  it('names the files that failed to download', async () => {
    const manifest = await publish('2026.10.09-1');
    served.delete('https://edge.forgecdn.net/files/1/2/cf.jar');
    await expect(syncPack({ gameDir, manifest, fetchImpl: fakeFetch })).rejects.toThrow(/mods\/cf\.jar \(HTTP 404\)/);
  }, 60_000);

  it('rejects a file whose sha1 does not match', async () => {
    const manifest = await publish('2026.10.09-1');
    served.set('https://edge.forgecdn.net/files/1/2/cf.jar', Buffer.from('tampered'));
    await expect(syncPack({ gameDir, manifest, fetchImpl: fakeFetch })).rejects.toThrow(/контрольная сумма/);
    await expect(stat(path.join(gameDir, 'mods', 'cf.jar'))).rejects.toThrow();
  }, 60_000);
});

describe('manifest validation', () => {
  it('only allows plain relative paths', () => {
    expect(isSafeRelativePath('mods/a.jar')).toBe(true);
    for (const bad of ['../a', 'mods/../../a', '/etc/passwd', 'C:/x', 'mods\\a.jar', '', 'mods//a']) {
      expect(isSafeRelativePath(bad), bad).toBe(false);
    }
  });

  it('refuses unknown formats and unsafe entries', () => {
    const ok = { formatVersion: 1, packVersion: 'x', minecraft: '1.21.1', neoforge: '21.1.256', files: [], overrides: null, managedDirs: ['mods'], firstInstallOnly: [] };
    expect(validateManifest(ok).files).toEqual([]);
    expect(() => validateManifest({ ...ok, formatVersion: 2 })).toThrow(/обновите лаунчер/);
    expect(() =>
      validateManifest({ ...ok, files: [{ path: '../evil.jar', sha1: 'a'.repeat(40), size: 1, url: 'https://x' }] }),
    ).toThrow(/неверную запись/);
    expect(() =>
      validateManifest({ ...ok, files: [{ path: 'mods/a.jar', sha1: 'a'.repeat(40), size: 1, url: 'http://x' }] }),
    ).toThrow(/неверную запись/);
  });
});

describe('fetchManifest', () => {
  it('explains a missing pack', async () => {
    const { fetchManifest } = await import('../src/main/install/pack');
    const notFound = (async () => new Response('nope', { status: 404 })) as typeof fetch;
    await expect(fetchManifest('https://example.test/manifest.json', notFound)).rejects.toThrow(/ещё не опубликована/);
  });
});
