import { describe } from 'vitest';

import { anchorFromTarget } from './anchor-from-target.ts';
import { targetFrom } from './target-from.ts';
import type { TargetState } from './target-from.ts';
import { createTwoHunkFileView } from './testing/create-two-hunk-file-view.ts';
import { test } from './testing/test.ts';

function anchorOf(overrides: Partial<TargetState>): ReturnType<typeof anchorFromTarget> {
  return anchorFromTarget(
    targetFrom({
      file: createTwoHunkFileView(),
      hunk: -1,
      selection: undefined,
      line: undefined,
      collapsed: false,
      ...overrides,
    }),
  );
}

describe('anchorFromTarget', () => {
  test('stages a head selection, and a base selection on its head lines', ({ expect }) => {
    expect(anchorOf({ selection: { start: 5, end: 4 } })).toStrictEqual({
      kind: 'lines',
      path: 'src/a.ts',
      startLine: 4,
      endLine: 5,
    });
    expect(
      anchorOf({ selection: { start: 3, end: 4, side: 'deletions', endSide: 'deletions' } }),
    ).toMatchObject({ startLine: 4, endLine: 5 });
  });

  test('stages the focused hunk’s head lines, or a jump’s line', ({ expect }) => {
    expect(anchorOf({ hunk: 1 })).toMatchObject({ startLine: 11, endLine: 12 });
    expect(anchorOf({ line: 7 })).toMatchObject({ startLine: 7, endLine: 7 });
  });

  test('anchors a pure deletion to the head line before it', ({ expect }) => {
    const file = createTwoHunkFileView({
      hunks: [{ oldStart: 4, oldCount: 2, newStart: 3, newCount: 0, header: '@@ -4,2 +3,0 @@' }],
      patch: 'diff --git a/src/a.ts b/src/a.ts\n@@ -4,2 +3,0 @@\n-x\n-y\n',
    });
    expect(anchorOf({ file, hunk: 0 })).toMatchObject({ startLine: 3, endLine: 3 });
  });

  test('anchors the file, a deleted file’s lines, and the whole change', ({ expect }) => {
    expect(anchorOf({})).toStrictEqual({ kind: 'file', path: 'src/a.ts' });
    const deleted = createTwoHunkFileView({ status: 'deleted' });
    expect(anchorOf({ file: deleted, hunk: 0 })).toStrictEqual({ kind: 'file', path: 'src/a.ts' });
    expect(
      anchorOf({ file: deleted, selection: { start: 1, end: 1, side: 'deletions' } }),
    ).toStrictEqual({ kind: 'file', path: 'src/a.ts' });
    expect(anchorOf({ file: undefined })).toStrictEqual({ kind: 'change' });
  });
});
