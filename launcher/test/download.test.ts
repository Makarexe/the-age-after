import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { downloadFile } from '../src/main/install/download';

const body = Buffer.alloc(100 * 1024, 0);
for (let i = 0; i < body.length; i++) body[i] = (i * 31) % 251;
const sha1 = createHash('sha1').update(body).digest('hex');

let server: Server;
let base: string;
let handler: (req: IncomingMessage, res: ServerResponse) => void;
const ranges: (string | undefined)[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    ranges.push(req.headers.range);
    handler(req, res);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  return new Promise<void>((r) => server.close(() => r()));
});

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'dl-'));
  ranges.length = 0;
});
afterEach(() => rm(dir, { recursive: true, force: true }));

/** Sends `data` in small pieces with a pause between them. */
function trickle(res: ServerResponse, data: Buffer, pieces: number, pauseMs: number, stopAfter = pieces) {
  const size = Math.ceil(data.length / pieces);
  let i = 0;
  const next = () => {
    if (i >= stopAfter) return; // stall: keep the connection open, send nothing more
    res.write(data.subarray(i * size, (i + 1) * size));
    i++;
    if (i >= pieces) res.end();
    else setTimeout(next, pauseMs);
  };
  next();
}

describe('downloadFile', () => {
  it('a slow but steady download is not cut off, however long it takes', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-length': body.length });
      trickle(res, body, 20, 60); // ~1.2 s in total, never 300 ms without data
    };
    const dest = path.join(dir, 'mods', 'big.jar');
    await downloadFile({ url: `${base}/big.jar`, dest, hash: { algorithm: 'sha1', value: sha1 }, idleTimeoutMs: 300 });
    expect((await readFile(dest)).equals(body)).toBe(true);
  });

  it('a stalled download resumes from where it stopped', async () => {
    let calls = 0;
    handler = (req, res) => {
      calls++;
      const m = req.headers.range?.match(/^bytes=(\d+)-$/);
      if (calls === 1) {
        res.writeHead(200, { 'content-length': body.length });
        trickle(res, body, 10, 10, 4); // 40% then silence
        return;
      }
      const from = Number(m![1]);
      res.writeHead(206, { 'content-length': body.length - from, 'content-range': `bytes ${from}-${body.length - 1}/${body.length}` });
      res.end(body.subarray(from));
    };
    const progress: number[] = [];
    const dest = path.join(dir, 'big.jar');
    await downloadFile({
      url: `${base}/big.jar`,
      dest,
      hash: { algorithm: 'sha1', value: sha1 },
      idleTimeoutMs: 200,
      onBytes: (d) => progress.push(d),
    });
    expect((await readFile(dest)).equals(body)).toBe(true);
    expect(ranges[0]).toBeUndefined();
    expect(ranges[1]).toMatch(/^bytes=\d+-$/);
    expect(Number(ranges[1]!.slice(6, -1))).toBeGreaterThan(0);
    expect(progress.reduce((a, b) => a + b, 0)).toBe(body.length);
    await expect(stat(`${dest}.part`)).rejects.toThrow();
  });

  it('starts over when the server ignores Range', async () => {
    let calls = 0;
    handler = (_req, res) => {
      calls++;
      res.writeHead(200, { 'content-length': body.length });
      if (calls === 1) trickle(res, body, 10, 10, 4);
      else res.end(body);
    };
    const dest = path.join(dir, 'big.jar');
    await downloadFile({ url: `${base}/big.jar`, dest, hash: { algorithm: 'sha1', value: sha1 }, idleTimeoutMs: 200 });
    expect((await readFile(dest)).equals(body)).toBe(true);
  });

  it('keeps the partial file when every attempt fails, and says why', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-length': body.length });
      trickle(res, body, 10, 10, 2);
    };
    const dest = path.join(dir, 'big.jar');
    let net = 0;
    await expect(
      downloadFile({ url: `${base}/big.jar`, dest, idleTimeoutMs: 100, retries: 1, onBytes: (d) => (net += d) }),
    ).rejects.toThrow(/нет данных/);
    expect((await stat(`${dest}.part`)).size).toBeGreaterThan(0);
    expect(net).toBe(0);
  });
}, 30_000);
