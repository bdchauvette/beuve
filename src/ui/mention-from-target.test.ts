import { describe } from 'vitest';

import { mentionFromTarget } from './mention-from-target.ts';
import { targetFrom } from './target-from.ts';
import type { TargetState } from './target-from.ts';
import { createTwoHunkFileView } from './testing/create-two-hunk-file-view.ts';
import { test } from './testing/test.ts';

function mentionOf(overrides: Partial<TargetState>): ReturnType<typeof mentionFromTarget> {
  return mentionFromTarget(
    targetFrom({
      file: createTwoHunkFileView({ status: 'renamed', oldPath: 'src/old.ts' }),
      hunk: -1,
      selection: undefined,
      line: undefined,
      collapsed: false,
      ...overrides,
    }),
  );
}

describe('mentionFromTarget', () => {
  test('takes a head selection, in order', ({ expect }) => {
    expect(mentionOf({ selection: { start: 5, end: 3, side: 'additions' } })).toStrictEqual({
      path: 'src/a.ts',
      side: 'head',
      startLine: 3,
      endLine: 5,
    });
  });

  test('names a base selection with the base path, and a mixed one by its head lines', ({
    expect,
  }) => {
    expect(
      mentionOf({ selection: { start: 11, end: 12, side: 'deletions', endSide: 'deletions' } }),
    ).toStrictEqual({ path: 'src/old.ts', side: 'base', startLine: 11, endLine: 12 });
    expect(
      mentionOf({ selection: { start: 2, end: 3, side: 'deletions', endSide: 'additions' } }),
    ).toStrictEqual({ path: 'src/a.ts', side: 'head', startLine: 1, endLine: 3 });
  });

  test('takes the focused hunk’s head lines, a pure deletion’s base lines, or a jump’s line', ({
    expect,
  }) => {
    expect(mentionOf({ hunk: 0 })).toStrictEqual({
      path: 'src/a.ts',
      side: 'head',
      startLine: 1,
      endLine: 5,
    });
    const file = createTwoHunkFileView({
      oldPath: 'src/old.ts',
      hunks: [
        { oldStart: 40, oldCount: 2, newStart: 42, newCount: 0, header: '@@ -40,2 +42,0 @@' },
      ],
      patch: 'diff --git a/src/a.ts b/src/a.ts\n@@ -40,2 +42,0 @@\n-x\n-y\n',
    });
    expect(mentionOf({ file, hunk: 0 })).toStrictEqual({
      path: 'src/old.ts',
      side: 'base',
      startLine: 40,
      endLine: 41,
    });
    expect(mentionOf({ line: 8 })).toStrictEqual({
      path: 'src/a.ts',
      side: 'head',
      startLine: 8,
      endLine: 8,
    });
  });

  test('takes the whole file, a deleted one on its base side, and nothing for the change', ({
    expect,
  }) => {
    expect(mentionOf({})).toStrictEqual({ path: 'src/a.ts', side: 'head' });
    const deleted = createTwoHunkFileView({ status: 'deleted', oldPath: 'src/old.ts' });
    expect(mentionOf({ file: deleted })).toStrictEqual({ path: 'src/old.ts', side: 'base' });
    expect(mentionOf({ file: undefined })).toBeUndefined();
  });
});
