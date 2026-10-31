import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { applySuggestedPatch } from './apply-suggested-patch.ts';
import { buildSuggestedPatch } from './build-suggested-patch.ts';

function head(): string {
  return 'a\nb\nc\nd\ne\nf\n';
}

describe('applySuggestedPatch', () => {
  test('reproduces the edit a suggestion was built from', ({ expect }) => {
    for (const [edited, startLine, endLine] of [
      ['a\nb\nC\nC2\nd\ne\nf\n', 3, 3],
      ['a\nd\ne\nf\n', 2, 3],
      ['a\nb\nc\nd\ne\nF', 6, 6],
      ['A\nb\nc\nd\ne\nf\n', 1, 1],
    ] as const) {
      const plan = buildSuggestedPatch({
        path: 'x',
        head: head(),
        edited,
        range: { startLine, endLine },
      });
      expect(plan.kind === 'patch' && applySuggestedPatch({ head: head(), patch: plan.text })).toBe(
        edited,
      );
    }
  });

  test('applies bare hunks from elsewhere, and refuses ones that do not match the head', ({
    expect,
  }) => {
    expect(applySuggestedPatch({ head: head(), patch: '@@ -2 +2 @@\n-b\n+B\n' })).toBe(
      'a\nB\nc\nd\ne\nf\n',
    );
    expect(applySuggestedPatch({ head: head(), patch: '@@ -2,0 +3,1 @@\n+b2\n' })).toBe(
      'a\nb\nb2\nc\nd\ne\nf\n',
    );
    expect(applySuggestedPatch({ head: head(), patch: '@@ -2 +2 @@\n-x\n+B\n' })).toBeUndefined();
    expect(applySuggestedPatch({ head: head(), patch: '@@ -9 +9 @@\n-x\n+B\n' })).toBeUndefined();
  });
});
