import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform, Writable } from 'node:stream';
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
  /** Called with byte deltas (negative when progress is rolled back). */
  onBytes?: (delta: number) => void;
  fetchImpl?: Fetch;
  retries?: number;
  /**
   * Give up on an attempt when no data has arrived for this long (connecting included). There is
   * no limit on the whole download: a big mod on a slow connection may take many minutes.
   */
  idleTimeoutMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Downloads to `<dest>.part`, checks the hash, then renames. After a dropped connection the next
 * attempt continues the `.part` with an HTTP Range request (or starts over if the server ignores
 * it); the `.part` is also kept for the next launch if every attempt fails.
 */
export async function downloadFile(opts: DownloadOptions): Promise<void> {
  const { url, dest, hash, onBytes, fetchImpl = fetch, retries = 4, idleTimeoutMs = 60_000 } = opts;
  await mkdir(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  let counted = 0; // bytes of this file currently reported through onBytes
  const report = (delta: number) => {
    if (!delta) return;
    counted += delta;
    onBytes?.(delta);
  };
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(1000 * attempt);
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => controller.abort(new Error(`нет данных ${Math.round(idleTimeoutMs / 1000)} с`)),
        idleTimeoutMs,
      );
    };
    try {
      const have = await stat(part).then(
        (s) => s.size,
        () => 0,
      );
      arm();
      const res = await fetchImpl(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: have > 0 ? { Range: `bytes=${have}-` } : undefined,
      });
      if (res.status === 416) {
        await rm(part, { force: true });
        throw new Error('HTTP 416');
      }
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const resume = have > 0 && res.status === 206;
      report((resume ? have : 0) - counted);

      const digest = hash ? createHash(hash.algorithm) : undefined;
      if (resume && digest) {
        await pipeline(
          createReadStream(part),
          new Writable({
            write(chunk: Buffer, _enc, cb) {
              digest.update(chunk);
              cb();
            },
          }),
        );
      }
      const meter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          arm();
          digest?.update(chunk);
          report(chunk.length);
          cb(null, chunk);
        },
      });
      await pipeline(
        Readable.fromWeb(res.body as import('node:stream/web').ReadableStream),
        meter,
        createWriteStream(part, { flags: resume ? 'a' : 'w' }),
      );
      clearTimeout(timer);
      if (digest && hash && digest.digest('hex') !== hash.value.toLowerCase()) {
        await rm(part, { force: true });
        report(-counted);
        throw new Error('контрольная сумма не совпала');
      }
      await rm(dest, { force: true });
      await rename(part, dest);
      return;
    } catch (err) {
      const reason: unknown = controller.signal.aborted ? controller.signal.reason : undefined;
      lastError = reason instanceof Error ? reason : err;
    } finally {
      clearTimeout(timer);
    }
  }
  // The .part stays for the next launch to resume; only the progress is rolled back.
  report(-counted);
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
