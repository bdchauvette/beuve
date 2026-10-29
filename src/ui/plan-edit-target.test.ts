import { describe, expect, it } from 'vitest';

import type { DiffFileView } from '#contract/ipc-contract.ts';

import { planEditTarget } from './plan-edit-target.ts';
import { createUraItemView } from './testing/create-ura-item-view.ts';

const head = 'a'.repeat(40);

const file: DiffFileView = {
  status: 'modified',
  path: 'src/a.ts',
  additions: 2,
  deletions: 1,
  binary: false,
  hunks: [{ oldStart: 1, oldCount: 5, newStart: 1, newCount: 6, header: '@@ -1,5 +1,6 @@' }],
  patch: [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,5 +1,6 @@',
    ' one',
    ' two',
    '-three',
    '+THREE',
    '+3b',
    ' four',
    ' five',
    '',
  ].join('\n'),
};

describe('planEditTarget', () => {
  it('edits the focused hunk, or the head-side selection, as a new suggestion', () => {
    expect(planEditTarget(file, 0, undefined, [], head)).toEqual({
      path: 'src/a.ts',
      startLine: 1,
      endLine: 6,
    });
    expect(planEditTarget(file, 0, { start: 5, end: 6, side: 'additions' }, [], head)).toEqual({
      path: 'src/a.ts',
      startLine: 5,
      endLine: 6,
    });
  });

  it('attaches to the staged note whose anchor the cursor is on', () => {
    const anchor = { kind: 'lines', path: 'src/a.ts', startLine: 2, endLine: 4 } as const;
    const item = createUraItemView({
      headSha: head,
      anchor,
      suggestedPatch: '@@ -2 +2 @@\n-two\n+2\n',
    });
    expect(planEditTarget(file, 0, undefined, [item], head)).toEqual({
      path: 'src/a.ts',
      startLine: 2,
      endLine: 4,
      itemId: item.id,
      patch: '@@ -2 +2 @@\n-two\n+2\n',
    });
  });

  it('ignores notes off the cursor, withdrawn, outdated or written on another head', () => {
    const items = [
      createUraItemView({ headSha: 'b'.repeat(40) }),
      createUraItemView({ headSha: head, status: { kind: 'withdrawn' } }),
      createUraItemView({
        headSha: head,
        anchor: { kind: 'lines', path: 'src/a.ts', startLine: 5, endLine: 6 },
      }),
    ];
    expect(planEditTarget(file, 0, undefined, items, head)?.itemId).toBeUndefined();
  });

  it('has nothing to edit without a hunk, or on a deleted file', () => {
    expect(planEditTarget(file, -1, undefined, [], head)).toBeUndefined();
    expect(planEditTarget({ ...file, status: 'deleted' }, 0, undefined, [], head)).toBeUndefined();
  });
});
