import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { nextCalverVersion } from './next-calver-version.ts';

function october(): Temporal.PlainDate {
  return Temporal.PlainDate.from('2026-10-29');
}

describe('nextCalverVersion', () => {
  test('starts a month at 1', ({ expect }) => {
    expect(nextCalverVersion([], october())).toBe('2026.10.1');
  });

  test('adds one to the highest release of the month', ({ expect }) => {
    expect(nextCalverVersion(['v2026.10.1', 'v2026.10.2'], october())).toBe('2026.10.3');
  });

  test('compares numbers, not strings, and follows the highest across gaps', ({ expect }) => {
    expect(nextCalverVersion(['v2026.10.2', 'v2026.10.9', 'v2026.10.10'], october())).toBe(
      '2026.10.11',
    );
    expect(nextCalverVersion(['v2026.10.1', 'v2026.10.4'], october())).toBe('2026.10.5');
  });

  test('rolls over to the next month and the next year', ({ expect }) => {
    expect(nextCalverVersion(['v2026.10.3'], Temporal.PlainDate.from('2026-11-01'))).toBe(
      '2026.11.1',
    );
    expect(nextCalverVersion(['v2026.12.2'], Temporal.PlainDate.from('2027-01-01'))).toBe(
      '2027.1.1',
    );
  });

  test('does not confuse month 1 with 10-12 or years with each other', ({ expect }) => {
    const tags = ['v2026.10.5', 'v2026.11.7', 'v2026.12.2', 'v2025.1.9'];
    expect(nextCalverVersion(tags, Temporal.PlainDate.from('2026-01-15'))).toBe('2026.1.1');
    expect(nextCalverVersion(tags, Temporal.PlainDate.from('2026-12-15'))).toBe('2026.12.3');
  });

  test('reads the date in UTC', ({ expect }) => {
    expect(nextCalverVersion([], Temporal.PlainDate.from('2026-10-31'))).toBe('2026.10.1');
    expect(nextCalverVersion([], Temporal.PlainDate.from('2026-11-01'))).toBe('2026.11.1');
  });

  test('ignores tags that are not calver tags', ({ expect }) => {
    const tags = [
      'v0.1.0',
      'v2026.10.1-dev.abc1234',
      'v2026.10.0',
      'v2026.10.07',
      'v2026.10.1+3',
      'v2026.10',
      'release-2026.10.9',
      '2026.10.8',
      'v2026.10.2',
    ];
    expect(nextCalverVersion(tags, october())).toBe('2026.10.3');
  });
});
