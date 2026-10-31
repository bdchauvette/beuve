import { describe } from 'vitest';

import { test } from './testing/test.ts';

import type { DiffFileView } from '#contract/ipc-contract.ts';

import { editTargetFrom } from './edit-target-from.ts';
import type { EditTarget } from './edit-target-from.ts';
import { targetFrom } from './target-from.ts';
import type { SelectedLines } from './target-from.ts';
import { createUraItemView } from './testing/create-ura-item-view.ts';

function head(): string {
  return 'a'.repeat(40);
}

function file(): DiffFileView {
  return {
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
}

/** The focused hunk and the selection, if any. */
interface Focus {
  readonly hunk: number;
  readonly selection?: SelectedLines;
}

function planned(
  { hunk, selection }: Focus,
  items: Parameters<typeof editTargetFrom>[1],
  overrides: Partial<DiffFileView> = {},
): EditTarget | undefined {
  const target = targetFrom({
    file: { ...file(), ...overrides },
    hunk,
    selection,
    line: undefined,
    collapsed: false,
  });
  return editTargetFrom(target, items, head());
}

describe('editTargetFrom', () => {
  test('edits the focused hunk, or the head-side selection, as a new suggestion', ({ expect }) => {
    expect(planned({ hunk: 0 }, [])).toStrictEqual({
      path: 'src/a.ts',
      startLine: 1,
      endLine: 6,
    });
    expect(
      planned({ hunk: 0, selection: { start: 5, end: 6, side: 'additions' } }, []),
    ).toStrictEqual({
      path: 'src/a.ts',
      startLine: 5,
      endLine: 6,
    });
  });

  test('attaches to the staged note whose anchor the cursor is on', ({ expect }) => {
    const anchor = { kind: 'lines', path: 'src/a.ts', startLine: 2, endLine: 4 } as const;
    const item = createUraItemView({
      headSha: head(),
      anchor,
      suggestedPatch: '@@ -2 +2 @@\n-two\n+2\n',
    });
    expect(planned({ hunk: 0 }, [item])).toStrictEqual({
      path: 'src/a.ts',
      startLine: 2,
      endLine: 4,
      itemId: item.id,
      patch: '@@ -2 +2 @@\n-two\n+2\n',
    });
  });

  test('ignores notes off the cursor, withdrawn, outdated or written on another head', ({
    expect,
  }) => {
    const items = [
      createUraItemView({ headSha: 'b'.repeat(40) }),
      createUraItemView({ headSha: head(), status: { kind: 'withdrawn' } }),
      createUraItemView({
        headSha: head(),
        anchor: { kind: 'lines', path: 'src/a.ts', startLine: 5, endLine: 6 },
      }),
    ];
    expect(planned({ hunk: 0 }, items)?.itemId).toBeUndefined();
  });

  test('has nothing to edit without a hunk, or on a deleted file', ({ expect }) => {
    expect(planned({ hunk: -1 }, [])).toBeUndefined();
    expect(planned({ hunk: 0 }, [], { status: 'deleted' })).toBeUndefined();
    expect(planned({ hunk: 0 }, [], { binary: true })).toBeUndefined();
  });
});
