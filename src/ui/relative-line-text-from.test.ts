import { describe } from 'vitest';

import { relativeLineTextFrom } from './relative-line-text-from.ts';
import { targetFrom } from './target-from.ts';
import type { TargetState } from './target-from.ts';
import { createTwoHunkFileView } from './testing/create-two-hunk-file-view.ts';
import { test } from './testing/test.ts';

function textOf(overrides: Partial<TargetState>): string | undefined {
  return relativeLineTextFrom(
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

describe('relativeLineTextFrom', () => {
  test('joins the file path and the target’s head line', ({ expect }) => {
    const { path } = createTwoHunkFileView();
    expect(textOf({ selection: { start: 5, end: 3 } })).toBe(`${path}:3`);
    expect(textOf({ hunk: 1 })).toBe(`${path}:11`);
    expect(textOf({ line: 9 })).toBe(`${path}:9`);
    expect(textOf({})).toBe(`${path}:1`);
  });

  test('copies the path alone for a file without head changes', ({ expect }) => {
    const file = createTwoHunkFileView({ patch: '', hunks: [] });
    expect(textOf({ file })).toBe(file.path);
  });

  test('has nothing to copy without an active file', ({ expect }) => {
    expect(textOf({ file: undefined })).toBeUndefined();
  });
});
