import { describe } from 'vitest';

import { targetFrom } from './target-from.ts';
import type { TargetState } from './target-from.ts';
import { createTwoHunkFileView } from './testing/create-two-hunk-file-view.ts';
import { test } from './testing/test.ts';

function state(overrides: Partial<TargetState> = {}): TargetState {
  return {
    file: createTwoHunkFileView(),
    hunk: -1,
    selection: undefined,
    line: undefined,
    collapsed: false,
    ...overrides,
  };
}

describe('targetFrom', () => {
  test('is the whole change without an active file', ({ expect }) => {
    expect(targetFrom(state({ file: undefined, hunk: 0 }))).toStrictEqual({ kind: 'change' });
  });

  test('is the file on a collapsed card, whatever was selected or focused before', ({ expect }) => {
    const target = targetFrom(
      state({ collapsed: true, hunk: 1, selection: { start: 4, end: 5 }, line: 3 }),
    );
    expect(target).toMatchObject({ kind: 'file', line: 1 });
  });

  test('prefers a selection over a jump’s line and the focused hunk', ({ expect }) => {
    const target = targetFrom(state({ hunk: 1, line: 12, selection: { start: 4, end: 5 } }));
    expect(target).toMatchObject({ kind: 'selection', side: 'head', start: 4, end: 5 });
  });

  test('prefers a jump’s line over the focused hunk', ({ expect }) => {
    expect(targetFrom(state({ hunk: 1, line: 3 }))).toMatchObject({ kind: 'line', line: 3 });
  });

  test('takes the focused hunk’s head and base lines and its first change', ({ expect }) => {
    expect(targetFrom(state({ hunk: 0 }))).toMatchObject({
      kind: 'hunk',
      index: 0,
      head: { start: 1, end: 5 },
      base: { start: 1, end: 4 },
      line: 1,
    });
    expect(targetFrom(state({ hunk: 1 }))).toMatchObject({ kind: 'hunk', index: 1, line: 11 });
  });

  test('has no head lines for a pure deletion hunk', ({ expect }) => {
    const file = createTwoHunkFileView({
      hunks: [{ oldStart: 4, oldCount: 2, newStart: 3, newCount: 0, header: '@@ -4,2 +3,0 @@' }],
      patch: 'diff --git a/src/a.ts b/src/a.ts\n@@ -4,2 +3,0 @@\n-x\n-y\n',
    });
    expect(targetFrom(state({ file, hunk: 0 }))).toMatchObject({
      head: undefined,
      base: { start: 4, end: 5 },
      line: 3,
    });
  });

  test('is the file with its first change when nothing is focused', ({ expect }) => {
    expect(targetFrom(state())).toMatchObject({ kind: 'file', line: 1 });
  });

  test('orders a selection dragged upwards, inline or in the split view’s right column', ({
    expect,
  }) => {
    const target = targetFrom(state({ selection: { start: 5, end: 3, side: 'additions' } }));
    expect(target).toMatchObject({ side: 'head', start: 3, end: 5, head: { start: 3, end: 5 } });
  });

  test('takes a full-width selection without sides as head lines', ({ expect }) => {
    expect(targetFrom(state({ selection: { start: 2, end: 2 } }))).toMatchObject({
      side: 'head',
      head: { start: 2, end: 2 },
    });
  });

  test('keeps the split view’s left column on the base side, with its head lines', ({ expect }) => {
    const selection = { start: 3, end: 4, side: 'deletions', endSide: 'deletions' } as const;
    expect(targetFrom(state({ selection }))).toMatchObject({
      kind: 'selection',
      side: 'base',
      start: 3,
      end: 4,
      head: { start: 4, end: 5 },
    });
  });

  test('maps deleted rows selected inline to the head line before them', ({ expect }) => {
    const selection = { start: 11, end: 11, side: 'deletions' } as const;
    expect(targetFrom(state({ selection }))).toMatchObject({
      side: 'base',
      start: 11,
      end: 11,
      head: { start: 11, end: 11 },
    });
  });

  test('maps a selection across both sides to head lines', ({ expect }) => {
    const selection = { start: 2, end: 3, side: 'deletions', endSide: 'additions' } as const;
    expect(targetFrom(state({ selection }))).toMatchObject({
      side: 'head',
      start: 1,
      end: 3,
      head: { start: 1, end: 3 },
    });
  });

  test('has no head lines for a base selection on a deleted file', ({ expect }) => {
    const selection = { start: 1, end: 2, side: 'deletions' } as const;
    const file = createTwoHunkFileView({ status: 'deleted' });
    expect(targetFrom(state({ file, selection }))).toMatchObject({ side: 'base', head: undefined });
  });
});
