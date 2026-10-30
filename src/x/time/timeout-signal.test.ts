import { once } from 'node:events';

import { test } from '#testing/test.ts';

import { timeoutSignal } from './timeout-signal.ts';

test('aborts with a TimeoutError once the duration has passed', async ({ expect, signal }) => {
  const timeout = timeoutSignal(Temporal.Duration.from({ milliseconds: 20 }));
  expect(timeout.aborted).toBe(false);
  await once(timeout, 'abort', { signal });
  expect(timeout.reason).toBeInstanceOf(DOMException);
  expect((timeout.reason as DOMException).name).toBe('TimeoutError');
});

test.for([
  ['a fractional millisecond', { microseconds: 1500 }],
  ['a zero duration', { seconds: 0 }],
  ['a negative duration', { milliseconds: -5 }],
] as const)('takes %s', async ([, duration], { expect, signal }) => {
  const timeout = timeoutSignal(Temporal.Duration.from(duration));
  await once(timeout, 'abort', { signal });
  expect(timeout.aborted).toBe(true);
});

test('tells its own timeout from a cancellation through AbortSignal.any', ({ expect }) => {
  const caller = new AbortController();
  const timeout = timeoutSignal(Temporal.Duration.from({ minutes: 1 }));
  const bounded = AbortSignal.any([caller.signal, timeout]);
  caller.abort();
  expect(bounded.aborted).toBe(true);
  expect(bounded.reason).not.toBe(timeout.reason);
  expect(bounded.reason).toBe(caller.signal.reason);
});
