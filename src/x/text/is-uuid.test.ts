import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { isUuid } from './is-uuid.ts';

describe('isUuid', () => {
  it('accepts what randomUUID produces', () => {
    expect(isUuid(randomUUID())).toBe(true);
  });

  it('rejects uppercase, unhyphenated and non-string values', () => {
    expect(isUuid(randomUUID().toUpperCase())).toBe(false);
    expect(isUuid(randomUUID().replaceAll('-', ''))).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(7)).toBe(false);
  });
});
