import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { formatIsoDuration } from './format-iso-duration.ts';

describe('formatIsoDuration', () => {
  test('shows the duration in the given locale, nothing when unknown', ({ expect }) => {
    expect(formatIsoDuration(undefined, 'en')).toBe('');
    expect(formatIsoDuration('PT0.9994S', 'en')).toBe('999ms');
    expect(formatIsoDuration('PT2.45S', 'en')).toBe('2s 450ms');
    expect(formatIsoDuration('PT2.45S', 'de')).toBe('2 Sek., 450 ms');
  });
});
