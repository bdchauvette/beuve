import { randomUUID } from 'node:crypto';

import { describe } from 'vitest';

import { isUuid } from './is-uuid.ts';
import { test } from '#testing/test.ts';

describe('isUuid', () => {
  test('accepts what randomUUID produces', ({ expect }) => {
    expect(isUuid(randomUUID())).toBe(true);
  });

  test('rejects uppercase, unhyphenated and non-string values', ({ expect }) => {
    expect(isUuid(randomUUID().toUpperCase())).toBe(false);
    expect(isUuid(randomUUID().replaceAll('-', ''))).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(7)).toBe(false);
  });
});
