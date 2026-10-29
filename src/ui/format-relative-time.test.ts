import { describe, expect, it } from 'vitest';

import { formatRelativeTime } from './format-relative-time.ts';

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-10-29T12:00:00Z');

  it('counts minutes, hours and days', () => {
    expect(formatRelativeTime('2026-10-29T11:59:30Z', now)).toBe('just now');
    expect(formatRelativeTime('2026-10-29T11:55:00Z', now)).toBe('5 min ago');
    expect(formatRelativeTime('2026-10-29T09:00:00Z', now)).toBe('3 h ago');
    expect(formatRelativeTime('2026-10-28T09:00:00Z', now)).toBe('yesterday');
    expect(formatRelativeTime('2026-10-25T09:00:00Z', now)).toBe('4 days ago');
  });

  it('is empty for an unreadable date', () => {
    expect(formatRelativeTime('soon', now)).toBe('');
  });
});
