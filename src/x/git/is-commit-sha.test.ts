import { describe, expect, it } from 'vitest';

import { isCommitSha } from './is-commit-sha.ts';

describe('isCommitSha', () => {
  it('accepts full lowercase SHA-1 and SHA-256 ids', () => {
    expect(isCommitSha('a'.repeat(40))).toBe(true);
    expect(isCommitSha('0'.repeat(64))).toBe(true);
  });

  it('rejects short, uppercase and non-string values', () => {
    expect(isCommitSha('a'.repeat(7))).toBe(false);
    expect(isCommitSha('A'.repeat(40))).toBe(false);
    expect(isCommitSha(undefined)).toBe(false);
  });
});
