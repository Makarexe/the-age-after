import { describe, expect, it } from 'vitest';
import { withRetries } from '../src/main/install/retry';

const noSleep = async () => {};

describe('withRetries', () => {
  it('returns as soon as an attempt succeeds', async () => {
    let calls = 0;
    const retries: number[] = [];
    const result = await withRetries(
      async () => {
        calls++;
        if (calls < 3) throw new Error('ECONNRESET');
        return 'ok';
      },
      { sleep: noSleep, onRetry: (attempt) => retries.push(attempt) },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
    expect(retries).toEqual([2, 3]);
  });

  it('gives up after the last attempt with the last error', async () => {
    let calls = 0;
    await expect(
      withRetries(
        async () => {
          calls++;
          throw new Error(`fail ${calls}`);
        },
        { attempts: 3, sleep: noSleep },
      ),
    ).rejects.toThrow('fail 3');
    expect(calls).toBe(3);
  });
});
