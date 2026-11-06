import { describe } from 'vitest';

import { timeTextFrom } from './time-text-from.ts';
import type { TimeRequest } from './time-text-from.ts';
import { test } from '../testing/test.ts';

describe('timeTextFrom', () => {
  test('formats an absolute time with the options given, or a medium date and short time', ({
    expect,
  }) => {
    expect(textOf({ dateTime: { timeZone: 'UTC' } })).toBe('Nov 6, 2026, 1:05 PM');
    expect(textOf({ dateTime: { timeZone: 'UTC', timeStyle: 'short' } })).toBe('1:05 PM');
    expect(textOf({ dateTime: { timeZone: 'UTC', weekday: 'long', day: 'numeric' } })).toBe(
      '6 Friday',
    );
  });

  test('titles every time with the full date and time', ({ expect }) => {
    expect(timeTextFrom(request({}))?.title).toBe('Friday, November 6, 2026 at 1:05:00 PM UTC');
  });

  test.for([
    [{ seconds: 20 }, 'now'],
    [{ minutes: 5 }, '5 minutes ago'],
    [{ minutes: 59, seconds: 59 }, '59 minutes ago'],
    [{ hours: 3 }, '3 hours ago'],
    [{ hours: 30 }, 'yesterday'],
    [{ hours: 96 }, '4 days ago'],
    [{ hours: 192 }, 'Oct 29'],
    [{ hours: 9600 }, 'Oct 2, 2025'],
  ] as const)('reads %j ago as “%s”', ([ago, expected], { expect }) => {
    const datetime = Temporal.Instant.from(nowIso()).subtract(ago).toString();
    expect(textOf({ format: 'relative', datetime })).toBe(expected);
  });

  test('reads a future time forward and takes the relative options', ({ expect }) => {
    const datetime = Temporal.Instant.from(nowIso()).add({ hours: 2 }).toString();
    expect(textOf({ format: 'relative', datetime })).toBe('in 2 hours');
    expect(
      textOf({ format: 'relative', datetime, relative: { numeric: 'always', style: 'short' } }),
    ).toBe('in 2 hr.');
  });

  test('says how soon a relative time goes stale, and never for an absolute one', ({ expect }) => {
    const minutesAgo = Temporal.Instant.from(nowIso()).subtract({ minutes: 5 }).toString();
    const daysAgo = Temporal.Instant.from(nowIso()).subtract({ hours: 50 }).toString();
    expect(
      timeTextFrom(request({ format: 'relative', datetime: minutesAgo }))?.refreshIn?.toString(),
    ).toBe('PT30S');
    expect(
      timeTextFrom(request({ format: 'relative', datetime: daysAgo }))?.refreshIn?.toString(),
    ).toBe('PT1H');
    expect(timeTextFrom(request({}))?.refreshIn).toBeUndefined();
  });

  test('shows nothing for text that is not an instant', ({ expect }) => {
    expect(timeTextFrom(request({ datetime: 'yesterday' }))).toBeUndefined();
  });
});

/** The fixed “now” every case is read against. */
function nowIso(): string {
  return '2026-11-06T13:05:00Z';
}

function request(overrides: Partial<TimeRequest>): TimeRequest {
  return {
    datetime: nowIso(),
    now: Temporal.Instant.from(nowIso()),
    format: 'absolute',
    dateTime: { timeZone: 'UTC' },
    relative: { numeric: 'auto' },
    relativeUntil: Temporal.Duration.from({ days: 7 }),
    locale: 'en-US',
    ...overrides,
  };
}

function textOf(overrides: Partial<TimeRequest>): string | undefined {
  return timeTextFrom(request(overrides))?.text;
}
