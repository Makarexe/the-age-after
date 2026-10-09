import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MinecraftFolder } from '@xmcl/core';
import { installResolvedAssetsTask } from '@xmcl/installer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDownloadAgent, describeError } from '../src/main/install/net';

const COUNT = 300;
const files = Array.from({ length: COUNT }, (_, i) => Buffer.from(`asset number ${i}`));
const assets = files.map((data, i) => {
  const hash = createHash('sha1').update(data).digest('hex');
  return { name: `minecraft/sounds/${i}.ogg`, hash, size: data.length };
});
const byHash = new Map(assets.map((a, i) => [a.hash, files[i]!]));

let server: Server;
let base: string;
let active = 0;
let maxActive = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    active++;
    maxActive = Math.max(maxActive, active);
    const hash = req.url!.split('/').pop()!;
    setTimeout(() => {
      active--;
      const body = byHash.get(hash);
      if (!body) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.setHeader('content-length', body.length);
      res.end(body);
    }, 5);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('asset downloads through a capped agent', () => {
  it('never opens more than the cap at once and still gets every file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'assets-'));
    try {
      const agent = createDownloadAgent(8);
      const folder = MinecraftFolder.from(dir);
      const task = installResolvedAssetsTask(assets, folder, { assetsHost: [base], dispatcher: agent });
      await task.startAndWait();
      expect(maxActive).toBeGreaterThan(1);
      expect(maxActive).toBeLessThanOrEqual(8);
      const sample = assets[123]!;
      expect(await readFile(path.join(dir, 'assets', 'objects', sample.hash.slice(0, 2), sample.hash))).toEqual(files[123]);
      await agent.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('describeError', () => {
  it('names the failed files', () => {
    const a = Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT', url: 'https://resources.download.minecraft.net/ab/abc' });
    const b = Object.assign(new Error('HTTP 503'), { url: 'https://x/2' });
    const text = describeError(new AggregateError([a, b, b, b, b]));
    expect(text).toContain('не скачалось файлов: 5');
    expect(text).toContain('connect ETIMEDOUT [ETIMEDOUT] — https://resources.download.minecraft.net/ab/abc');
    expect(text).toContain('и ещё 2');
  });
});
