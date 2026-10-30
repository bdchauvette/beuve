import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { createTwoHunkFileView } from './testing/create-two-hunk-file-view.ts';
import { mentionFromTarget } from './mention-from-target.ts';
import { targetFromAnchor } from './target-from-anchor.ts';

describe('targetFromAnchor', () => {
  test('reads a lines anchor as a head selection, which ⌘> adds as those lines', ({ expect }) => {
    const file = createTwoHunkFileView();
    const target = targetFromAnchor({ kind: 'lines', path: 'src/a.ts', startLine: 2, endLine: 3 }, [
      file,
    ]);
    expect(target).toStrictEqual({
      kind: 'selection',
      file,
      side: 'head',
      start: 2,
      end: 3,
      head: { start: 2, end: 3 },
    });
    expect(target === undefined ? undefined : mentionFromTarget(target)).toStrictEqual({
      path: 'src/a.ts',
      side: 'head',
      startLine: 2,
      endLine: 3,
    });
  });

  test('reads a file anchor as the file, a deleted one on its base side', ({ expect }) => {
    const file = createTwoHunkFileView({ status: 'deleted', oldPath: 'src/old.ts' });
    const target = targetFromAnchor({ kind: 'file', path: 'src/a.ts' }, [file]);
    expect(target).toStrictEqual({ kind: 'file', file, line: 1 });
    expect(target === undefined ? undefined : mentionFromTarget(target)).toStrictEqual({
      path: 'src/old.ts',
      side: 'base',
    });
  });

  test('keeps the whole change, and finds nothing for a file outside the diff', ({ expect }) => {
    expect(targetFromAnchor({ kind: 'change' }, [])).toStrictEqual({ kind: 'change' });
    expect(targetFromAnchor({ kind: 'file', path: 'src/z.ts' }, [])).toBeUndefined();
  });
});
