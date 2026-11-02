import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { open, walkEntriesGenerator } from '@xmcl/unzip';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureFixPack, FIX_PACK, withPackEnabled } from '../src/main/resourcepack';

const ID = `file/${FIX_PACK}`;
const bundled = path.join(__dirname, '..', 'resources', FIX_PACK);

describe('withPackEnabled', () => {
  it('puts the pack right above the mods and below the player packs', () => {
    const out = withPackEnabled('a:1\nresourcePacks:["vanilla","mod_resources","file/mine.zip"]\nb:2\n')!;
    expect(out).toContain(`resourcePacks:["vanilla","mod_resources","${ID}","file/mine.zip"]`);
    expect(out.startsWith('a:1\n') && out.endsWith('b:2\n')).toBe(true);
  });
  it('adds the line when options.txt has none, and does nothing twice', () => {
    const out = withPackEnabled('a:1\n')!;
    expect(out).toBe(`a:1\nresourcePacks:["vanilla","mod_resources","${ID}"]\n`);
    expect(withPackEnabled(out)).toBeNull();
  });
  it('leaves a line it cannot parse alone', () => {
    expect(withPackEnabled('resourcePacks:[oops\n')).toBeNull();
  });
});

describe('bundled pack', () => {
  it('is a 1.21.1 pack with forward-slash paths and the vanilla glazed terracotta rotations', async () => {
    const zip = await open(bundled);
    const names: string[] = [];
    for await (const e of walkEntriesGenerator(zip)) names.push(e.fileName);
    expect(names).toContain('pack.mcmeta');
    expect(names.every((n) => !n.includes('\\'))).toBe(true);
    expect(names.filter((n) => n.startsWith('assets/minecraft/blockstates/')).length).toBeGreaterThanOrEqual(42);
    zip.close();
  });
});

describe('ensureFixPack', () => {
  let dir: string;
  afterEach(() => rm(dir, { recursive: true, force: true }));
  it('copies the pack and enables it once', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'rp-'));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'options.txt'), 'resourcePacks:["vanilla","mod_resources"]\n');
    expect(await ensureFixPack(dir, bundled)).toBe(true);
    expect((await readFile(path.join(dir, 'resourcepacks', FIX_PACK))).length).toBeGreaterThan(1000);
    expect(await readFile(path.join(dir, 'options.txt'), 'utf8')).toContain(ID);
    expect(await ensureFixPack(dir, bundled)).toBe(false);
  });
});
