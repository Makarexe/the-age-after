/**
 * Retries a flaky network step: Mojang and maven servers sometimes fail for a minute and then
 * work again, so the player shouldn't have to press "Играть" twice.
 */
export async function withRetries<T>(
  fn: () => Promise<T>,
  opts: {
    attempts?: number;
    delayMs?: number;
    onRetry?: (attempt: number, attempts: number, err: unknown) => void;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<T> {
  const { attempts = 3, delayMs = 3000, onRetry, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = opts;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts) throw err;
      onRetry?.(attempt + 1, attempts, err);
      await sleep(delayMs * attempt);
    }
  }
}
