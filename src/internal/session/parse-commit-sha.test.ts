import { describe, expect, it } from 'vitest';

import { parseCommitSha } from './parse-commit-sha.ts';

describe('parseCommitSha', () => {
  it('accepts SHA-1 and SHA-256 ids and lowercases them', () => {
    expect(parseCommitSha('A'.repeat(40))).toEqual({ ok: true, value: 'a'.repeat(40) });
    expect(parseCommitSha('0f'.repeat(32))).toEqual({ ok: true, value: '0f'.repeat(32) });
  });

  it.each(['', 'abc1234', 'a'.repeat(41), 'g'.repeat(40), ` ${'a'.repeat(40)}`, 'HEAD'])(
    'rejects %j',
    (value) => {
      expect(parseCommitSha(value)).toEqual({
        ok: false,
        error: { kind: 'invalid-commit-sha', value },
      });
    },
  );
});
