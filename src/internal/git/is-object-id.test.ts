import { describe, expect, it } from 'vitest';

import { isObjectId } from './is-object-id.ts';

describe('isObjectId', () => {
  it('matches 40 or 64 lowercase hex digits', () => {
    expect(isObjectId('f'.repeat(40))).toBe(true);
    expect(isObjectId('f'.repeat(64))).toBe(true);
    expect(isObjectId('f'.repeat(41))).toBe(false);
    expect(isObjectId('--output=x')).toBe(false);
  });
});
