import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { isCommitSha } from './is-commit-sha.ts';

describe('isCommitSha', () => {
  test('accepts full lowercase SHA-1 and SHA-256 ids', ({ expect }) => {
    expect(isCommitSha('a'.repeat(40))).toBe(true);
    expect(isCommitSha('0'.repeat(64))).toBe(true);
  });

  test('rejects short, uppercase and non-string values', ({ expect }) => {
    expect(isCommitSha('a'.repeat(7))).toBe(false);
    expect(isCommitSha('A'.repeat(40))).toBe(false);
    expect(isCommitSha(undefined)).toBe(false);
  });
});
