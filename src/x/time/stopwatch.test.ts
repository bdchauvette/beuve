import { setTimeout as sleep } from 'node:timers/promises';
import { vi } from 'vitest';

import { Stopwatch } from './stopwatch.ts';
import { test } from '#testing/test.ts';

test('measures real elapsed time as a Duration', async ({ expect }) => {
  const stopwatch = new Stopwatch();
  await sleep(30);
  const elapsed = stopwatch.elapsed();
  expect(Temporal.Duration.compare(elapsed, { milliseconds: 25 })).toBeGreaterThanOrEqual(0);
  expect(Temporal.Duration.compare(elapsed, { seconds: 5 })).toBeLessThan(0);
});

test('never goes backwards', ({ expect }) => {
  const stopwatch = new Stopwatch();
  const first = stopwatch.elapsed();
  const second = stopwatch.elapsed();
  expect(Temporal.Duration.compare(second, first)).toBeGreaterThanOrEqual(0);
});

test('reads elapsed time from an injected clock', ({ expect }) => {
  const clock = { nanoseconds: 5_000_000_000n };
  const stopwatch = new Stopwatch({ now: (): bigint => clock.nanoseconds });
  expect(Temporal.Duration.compare(stopwatch.elapsed(), { nanoseconds: 0 })).toBe(0);
  clock.nanoseconds += 1_234_567_890n;
  expect(stopwatch.elapsed()).toStrictEqual(
    Temporal.Duration.from({ seconds: 1, milliseconds: 234, microseconds: 567, nanoseconds: 890 }),
  );
});

test('is not moved by the faked wall clock', { concurrent: false }, async ({ expect, clock }) => {
  const stopwatch = new Stopwatch();
  clock.advance({ hours: 5 });
  await sleep(1);
  expect(Temporal.Duration.compare(stopwatch.elapsed(), { minutes: 1 })).toBeLessThan(0);
});

test(
  'falls back to performance.now where there is no process',
  { concurrent: false },
  async ({ expect }) => {
    // The renderer has no `process`; the only way to run that path is to remove it.
    // eslint-disable-next-line vitest/no-restricted-vi-methods -- stubbing the environment, not a module
    vi.stubGlobal('process', undefined);
    const stopwatch = new Stopwatch();
    await sleep(30);
    const elapsed = stopwatch.elapsed();
    vi.unstubAllGlobals();
    expect(Temporal.Duration.compare(elapsed, { milliseconds: 25 })).toBeGreaterThanOrEqual(0);
    expect(Temporal.Duration.compare(elapsed, { seconds: 5 })).toBeLessThan(0);
  },
);
