import { describe } from 'vitest';

import { isObjectId } from './is-object-id.ts';
import { test } from './testing/test.ts';

describe('isObjectId', () => {
  test('matches 40 or 64 lowercase hex digits', ({ expect }) => {
    expect(isObjectId('f'.repeat(40))).toBe(true);
    expect(isObjectId('f'.repeat(64))).toBe(true);
    expect(isObjectId('f'.repeat(41))).toBe(false);
    expect(isObjectId('--output=x')).toBe(false);
  });
});
