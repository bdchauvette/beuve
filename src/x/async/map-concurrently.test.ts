import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { mapConcurrently } from './map-concurrently.ts';

describe('mapConcurrently', () => {
  test('keeps the order of the items and never runs more than the limit at once', async ({
    expect,
  }) => {
    let running = 0;
    let most = 0;
    const results = await mapConcurrently([5, 1, 4, 2, 3], { limit: 2 }, async (value, index) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => {
        setTimeout(resolve, value);
      });
      running -= 1;
      return `${String(index)}:${String(value)}`;
    });
    expect(results).toStrictEqual(['0:5', '1:1', '2:4', '3:2', '4:3']);
    expect(most).toBe(2);
  });

  test('maps nothing to nothing', async ({ expect }) => {
    await expect(
      mapConcurrently([], { limit: 4 }, async () => {
        await Promise.resolve();
        return 1;
      }),
    ).resolves.toStrictEqual([]);
  });

  test('rejects with the first failure and starts nothing after it', async ({ expect }) => {
    const started: number[] = [];
    await expect(
      mapConcurrently([1, 2, 3, 4], { limit: 1 }, async (value) => {
        started.push(value);
        await Promise.resolve();
        if (value === 2) {
          throw new Error('two');
        }
        return value;
      }),
    ).rejects.toThrow('two');
    expect(started).toStrictEqual([1, 2]);
  });
});
