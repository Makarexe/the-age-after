import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureDistantHorizonsRendering } from '../src/main/distant-horizons';

let dir: string;
const file = () => path.join(dir, 'config', 'DistantHorizons.toml');
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'dh-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('ensureDistantHorizonsRendering', () => {
  it('switches a disabled renderer on and keeps the rest', async () => {
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file(), '[client.advanced.debugging]\n\t\trendererMode = "DISABLED"\n\t\tshowOverlappingQuadErrors = false\n');
    expect(await ensureDistantHorizonsRendering(dir)).toBe(true);
    expect(await readFile(file(), 'utf8')).toBe('[client.advanced.debugging]\n\t\trendererMode = "DEFAULT"\n\t\tshowOverlappingQuadErrors = false\n');
    expect(await ensureDistantHorizonsRendering(dir)).toBe(false);
  });

  it('does nothing without a config or for another mode', async () => {
    expect(await ensureDistantHorizonsRendering(dir)).toBe(false);
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file(), 'rendererMode = "DEBUG_TRIANGLE"\n');
    expect(await ensureDistantHorizonsRendering(dir)).toBe(false);
  });
});
