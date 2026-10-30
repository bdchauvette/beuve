import { parseCommitSha } from './parse-commit-sha.ts';
import { test } from './testing/test.ts';

test('parseCommitSha accepts SHA-1 and SHA-256 ids and lowercases them', ({ expect }) => {
  expect(parseCommitSha('A'.repeat(40))).toStrictEqual({ ok: true, value: 'a'.repeat(40) });
  expect(parseCommitSha('0f'.repeat(32))).toStrictEqual({ ok: true, value: '0f'.repeat(32) });
});

test.for(['', 'abc1234', 'a'.repeat(41), 'g'.repeat(40), ` ${'a'.repeat(40)}`, 'HEAD'])(
  'parseCommitSha rejects %j',
  (value, { expect }) => {
    expect(parseCommitSha(value)).toStrictEqual({
      ok: false,
      error: { kind: 'invalid-commit-sha', value },
    });
  },
);
