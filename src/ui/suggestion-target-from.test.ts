import { describe } from 'vitest';

import { test } from './testing/test.ts';

import type { DiffFileView } from '#contract/ipc-contract.ts';

import { suggestionTargetFrom } from './suggestion-target-from.ts';
import type { SuggestionTarget } from './suggestion-target-from.ts';
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
  items: Parameters<typeof suggestionTargetFrom>[1],
  overrides: Partial<DiffFileView> = {},
): SuggestionTarget {
  const target = targetFrom({
    file: { ...file(), ...overrides },
    hunk,
    selection,
    line: undefined,
    collapsed: false,
  });
  return suggestionTargetFrom(target, items, head());
}

describe('suggestionTargetFrom', () => {
  test('takes the focused hunk, or the head-side selection, for a new note', ({ expect }) => {
    expect(planned({ hunk: 0 }, [])).toStrictEqual({
      kind: 'lines',
      lines: { path: 'src/a.ts', startLine: 1, endLine: 6 },
    });
    expect(
      planned({ hunk: 0, selection: { start: 5, end: 6, side: 'additions' } }, []),
    ).toStrictEqual({ kind: 'lines', lines: { path: 'src/a.ts', startLine: 5, endLine: 6 } });
  });

  test('adds to the staged note whose anchor the cursor is on', ({ expect }) => {
    const anchor = { kind: 'lines', path: 'src/a.ts', startLine: 2, endLine: 4 } as const;
    const item = createUraItemView({ headSha: head(), anchor });
    expect(
      planned({ hunk: 0, selection: { start: 3, end: 3, side: 'additions' } }, [item]),
    ).toStrictEqual({
      kind: 'lines',
      lines: { path: 'src/a.ts', startLine: 3, endLine: 3 },
      itemId: item.id,
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
        placement: { kind: 'outdated', reason: 'lines-changed' },
      }),
      createUraItemView({
        headSha: head(),
        anchor: { kind: 'lines', path: 'src/a.ts', startLine: 5, endLine: 6 },
      }),
    ];
    expect(planned({ hunk: 0 }, items)).toStrictEqual({
      kind: 'lines',
      lines: { path: 'src/a.ts', startLine: 1, endLine: 6 },
    });
  });

  test('says why there are no lines without a hunk, or on a deleted or binary file', ({
    expect,
  }) => {
    expect(planned({ hunk: -1 }, [])).toStrictEqual({
      kind: 'refused',
      reason: 'Select head lines, or pick a hunk with Next Change, to add a suggestion.',
    });
    expect(planned({ hunk: 0 }, [], { status: 'deleted' })).toMatchObject({ kind: 'refused' });
    expect(planned({ hunk: 0 }, [], { binary: true })).toMatchObject({ kind: 'refused' });
  });
});
