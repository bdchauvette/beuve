import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { formatDuration } from './format-duration.ts';

describe('formatDuration', () => {
  test('shows milliseconds under a second and seconds above, nothing when unknown', ({
    expect,
  }) => {
    expect(formatDuration(undefined)).toBe('');
    expect(formatDuration('PT0.9994S')).toBe('999 ms');
    expect(formatDuration('PT2.45S')).toBe('2.5 s');
  });
});
