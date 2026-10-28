import { describe, expect, it } from 'vitest';

import { formatDuration } from './format-duration.ts';

describe('formatDuration', () => {
  it('shows milliseconds under a second and seconds above, nothing when unknown', () => {
    expect(formatDuration(undefined)).toBe('');
    expect(formatDuration(999.4)).toBe('999 ms');
    expect(formatDuration(2450)).toBe('2.5 s');
  });
});
