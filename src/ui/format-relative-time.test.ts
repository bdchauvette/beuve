import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { formatRelativeTime } from './format-relative-time.ts';

describe('formatRelativeTime', () => {
  test('counts minutes, hours and days', ({ expect }) => {
    const now = Temporal.Instant.from('2026-10-29T12:00:00Z');
    expect(formatRelativeTime('2026-10-29T11:59:30Z', now)).toBe('just now');
    expect(formatRelativeTime('2026-10-29T11:55:00Z', now)).toBe('5 min ago');
    expect(formatRelativeTime('2026-10-29T09:00:00Z', now)).toBe('3 h ago');
    expect(formatRelativeTime('2026-10-28T09:00:00Z', now)).toBe('yesterday');
    expect(formatRelativeTime('2026-10-25T09:00:00Z', now)).toBe('4 days ago');
  });

  test('is empty for an unreadable date', ({ expect }) => {
    const now = Temporal.Instant.from('2026-10-29T12:00:00Z');
    expect(formatRelativeTime('soon', now)).toBe('');
  });
});
