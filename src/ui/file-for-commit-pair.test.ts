import { describe } from 'vitest';

import { test } from './testing/test.ts';

import type { FileAttributionView } from '#contract/ipc-contract.ts';

import { createTwoHunkFileView } from './testing/create-two-hunk-file-view.ts';
import { fileForCommitPair } from './file-for-commit-pair.ts';

function attribution(hunkPairIds: readonly (readonly string[])[]): FileAttributionView {
  return { path: 'src/a.ts', pairIds: [...new Set(hunkPairIds.flat()), 'touched'], hunkPairIds };
}

describe('fileForCommitPair', () => {
  test('keeps only the hunks the pair produced, with the patch and counts rebuilt', ({
    expect,
  }) => {
    const file = createTwoHunkFileView();
    const narrowed = fileForCommitPair(file, attribution([['c1'], ['c2']]), 'c2');
    expect(narrowed).toStrictEqual({
      ...file,
      additions: 0,
      deletions: 1,
      hunks: [file.hunks[1]],
      patch: [
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -10,3 +11,2 @@',
        ' ten',
        '-eleven',
        ' twelve',
        '',
      ].join('\n'),
    });
  });

  test('keeps the whole file when every hunk, or no hunk, is the pair’s', ({ expect }) => {
    const file = createTwoHunkFileView();
    expect(fileForCommitPair(file, attribution([['c1'], ['c1', 'c2']]), 'c1')).toBe(file);
    expect(fileForCommitPair(file, attribution([['c1'], ['c2']]), 'touched')).toBe(file);
  });

  test('drops a file the pair never touched', ({ expect }) => {
    const file = createTwoHunkFileView();
    expect(fileForCommitPair(file, attribution([['c1'], []]), 'c9')).toBeUndefined();
    expect(fileForCommitPair(file, undefined, 'c1')).toBeUndefined();
  });
});
