import { describe, expect, test } from 'bun:test';
import { runPool } from '../src/pool.ts';

describe('runPool', () => {
  test('preserves input order', async () => {
    const items = [1, 2, 3, 4, 5];
    const out = await runPool(items, async (n) => n * 10, 2);
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  test('respects concurrency cap', async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    await runPool(
      items,
      async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      },
      4,
    );
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  test('handles empty input', async () => {
    const out = await runPool([], async (x) => x, 4);
    expect(out).toEqual([]);
  });

  test('concurrency 1 = serial', async () => {
    const order: number[] = [];
    await runPool(
      [3, 1, 2],
      async (n) => {
        await new Promise((r) => setTimeout(r, n * 5));
        order.push(n);
      },
      1,
    );
    expect(order).toEqual([3, 1, 2]);
  });
});
