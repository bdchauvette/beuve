import { describe, expect, it } from 'vitest';

import { isIsoTimestamp } from './is-iso-timestamp.ts';

describe('isIsoTimestamp', () => {
  it('accepts toISOString output', () => {
    expect(isIsoTimestamp(new Date(0).toISOString())).toBe(true);
  });

  it('rejects other shapes and impossible dates', () => {
    expect(isIsoTimestamp('2026-10-30')).toBe(false);
    expect(isIsoTimestamp('2026-10-30T00:00:00Z')).toBe(false);
    expect(isIsoTimestamp('2026-13-30T00:00:00.000Z')).toBe(false);
    expect(isIsoTimestamp(0)).toBe(false);
  });
});
