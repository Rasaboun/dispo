export async function runPool<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency: number,
  opts: { startDelayMs?: number; delayImpl?: (ms: number) => Promise<void> } = {},
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const startDelayMs = Math.max(0, opts.startDelayMs ?? 0);
  const delayImpl = opts.delayImpl ?? delay;
  let nextStartAt = performance.now();
  let cursor = 0;

  async function waitForTurn(): Promise<void> {
    if (startDelayMs === 0) return;
    const now = performance.now();
    const waitMs = Math.max(0, nextStartAt - now);
    nextStartAt = Math.max(now, nextStartAt) + startDelayMs;
    if (waitMs > 0) await delayImpl(waitMs);
  }

  async function runner(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      await waitForTurn();
      results[i] = await worker(items[i]!, i);
    }
  }

  await Promise.all(Array.from({ length: limit }, runner));
  return results;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
