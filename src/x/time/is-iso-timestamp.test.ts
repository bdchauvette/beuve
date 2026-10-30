import { describe } from 'vitest';

import { isIsoTimestamp } from './is-iso-timestamp.ts';
import { test } from '#testing/test.ts';

describe('isIsoTimestamp', () => {
  test('accepts toISOString output', ({ expect }) => {
    expect(
      isIsoTimestamp(
        Temporal.Instant.fromEpochMilliseconds(0).toString({ fractionalSecondDigits: 3 }),
      ),
    ).toBe(true);
  });

  test('rejects other shapes and impossible dates', ({ expect }) => {
    expect(isIsoTimestamp('2026-10-30')).toBe(false);
    expect(isIsoTimestamp('2026-10-30T00:00:00Z')).toBe(false);
    expect(isIsoTimestamp('2026-13-30T00:00:00.000Z')).toBe(false);
    expect(isIsoTimestamp(0)).toBe(false);
  });
});
