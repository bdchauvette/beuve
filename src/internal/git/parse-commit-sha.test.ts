import { describe, expect, it } from 'vitest';

import { parseCommitSha } from './parse-commit-sha.ts';

describe('parseCommitSha', () => {
  it('accepts full SHA-1 and SHA-256 names only', () => {
    expect(parseCommitSha('a'.repeat(40))).toBe('a'.repeat(40));
    expect(parseCommitSha('0123456789abcdef'.repeat(4))).toHaveLength(64);
    expect(parseCommitSha('abc123')).toBeUndefined();
    expect(parseCommitSha('A'.repeat(40))).toBeUndefined();
    expect(parseCommitSha(`${'a'.repeat(40)}\n`)).toBeUndefined();
  });
});
