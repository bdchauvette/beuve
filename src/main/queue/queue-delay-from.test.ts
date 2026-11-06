import { describe } from 'vitest';

import { test } from '../testing/test.ts';
import { queueDelayFrom } from './queue-delay-from.ts';

describe('queueDelayFrom', () => {
  test.for([
    [0, { minutes: 5 }],
    [1, { minutes: 10 }],
    [2, { minutes: 20 }],
    [3, { minutes: 30 }],
    [9, { minutes: 30 }],
  ] as const)('after %i failures waits %o', ([failures, expected], { expect }) => {
    const delay = queueDelayFrom({
      interval: Temporal.Duration.from({ minutes: 5 }),
      failures,
      rateLimitedUntil: undefined,
    });
    expect(Temporal.Duration.compare(delay, expected)).toBe(0);
  });

  test.for([
    ['2026-10-28T12:10:00Z', { minutes: 10, seconds: 1 }],
    ['2026-10-28T12:00:10Z', { minutes: 1 }],
    ['2026-10-28T14:00:00Z', { minutes: 30 }],
  ] as const)(
    'waits for a rate limit resetting at %s',
    { concurrent: false },
    ([resetAt, expected], { expect, clock }) => {
      clock.set('2026-10-28T12:00:00Z');
      const delay = queueDelayFrom({
        interval: Temporal.Duration.from({ minutes: 5 }),
        failures: 0,
        rateLimitedUntil: resetAt,
      });
      expect(Temporal.Duration.compare(delay, expected)).toBe(0);
    },
  );
});
