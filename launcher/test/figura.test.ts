import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureFiguraServer } from '../src/main/figura';

const HOST = 'figura-production.up.railway.app';
let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'figura-'));
  file = path.join(dir, 'config', 'figura.json');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const read = async () => JSON.parse(await readFile(file, 'utf8'));

describe('figura.json', () => {
  it('creates the config when Figura has not run yet', async () => {
    expect(await ensureFiguraServer(dir, HOST)).toBe(true);
    expect(await read()).toEqual({ CONFIG_VERSION: 1, server_ip: HOST });
  });

  it("sets our cloud and keeps the player's other settings", async () => {
    await mkdir(path.dirname(file), { recursive: true });
    // What Figura itself writes (pretty-printed by Gson).
    await writeFile(file, JSON.stringify({ CONFIG_VERSION: 1, server_ip: 'figura.moonlight-devs.org', preview_head_rotation: true, chat_messages: 2 }, null, 2));
    expect(await ensureFiguraServer(dir, HOST)).toBe(true);
    expect(await read()).toEqual({ CONFIG_VERSION: 1, server_ip: HOST, preview_head_rotation: true, chat_messages: 2 });
    expect(await ensureFiguraServer(dir, HOST)).toBe(false);
  });

  it('fills in the address in the near-empty file from the pack configs', async () => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '{\n  "CONFIG_VERSION": 1\n}');
    expect(await ensureFiguraServer(dir, HOST)).toBe(true);
    expect(await read()).toEqual({ CONFIG_VERSION: 1, server_ip: HOST });
  });

  it('leaves a file it cannot read alone', async () => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '{ broken');
    expect(await ensureFiguraServer(dir, HOST)).toBe(false);
    expect(await readFile(file, 'utf8')).toBe('{ broken');
  });
});
