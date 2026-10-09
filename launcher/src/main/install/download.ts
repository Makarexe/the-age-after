import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export type Fetch = typeof fetch;

export async function hashFile(file: string, algorithm: 'sha1' | 'sha256' = 'sha1'): Promise<string> {
  const hash = createHash(algorithm);
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

export interface DownloadOptions {
  url: string;
  dest: string;
  /** Expected hash; the file is only moved into place if it matches. */
  hash?: { algorithm: 'sha1' | 'sha256'; value: string };
  /** Called with byte deltas (negative when a failed attempt is rolled back). */
  onBytes?: (delta: number) => void;
  fetchImpl?: Fetch;
  retries?: number;
  timeoutMs?: number;
}

/** Downloads to `<dest>.part`, checks the hash, then renames. Retries with a short backoff. */
export async function downloadFile(opts: DownloadOptions): Promise<void> {
  const { url, dest, hash, onBytes, fetchImpl = fetch, retries = 3, timeoutMs = 120_000 } = opts;
  await mkdir(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * attempt));
    let received = 0;
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const digest = hash ? createHash(hash.algorithm) : undefined;
      const meter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          received += chunk.length;
          digest?.update(chunk);
          onBytes?.(chunk.length);
          cb(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), meter, createWriteStream(part));
      if (digest && hash) {
        const actual = digest.digest('hex');
        if (actual !== hash.value.toLowerCase()) throw new Error(`контрольная сумма не совпала`);
      }
      await rm(dest, { force: true });
      await rename(part, dest);
      return;
    } catch (err) {
      lastError = err;
      onBytes?.(-received);
      await rm(part, { force: true }).catch(() => {});
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Runs `worker` over `items` with at most `concurrency` at a time; collects every failure. */
export async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<{ item: T; error: unknown }[]> {
  const failures: { item: T; error: unknown }[] = [];
  let next = 0;
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      try {
        await worker(item);
      } catch (error) {
        failures.push({ item, error });
      }
    }
  });
  await Promise.all(lanes);
  return failures;
}
