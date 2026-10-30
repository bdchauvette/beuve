import { describe } from 'vitest';

import { test } from './testing/test.ts';

import type { DiffFileView } from '#contract/ipc-contract.ts';

import { findInReview } from './find-in-review.ts';
import { createDiffFileView } from './testing/create-diff-file-view.ts';

function files(): DiffFileView[] {
  return [
    createDiffFileView(
      'src/a.ts',
      [' const total = 1;', '-let Total = 2;', '+const total = 3;'],
      10,
    ),
    createDiffFileView('src/b.ts', ['+total total', ' unchanged'], 1),
  ];
}

describe('findInReview', () => {
  test('finds every hit in stream order with its side and line number', ({ expect }) => {
    expect(findInReview(files(), 'total')).toStrictEqual([
      { fileIndex: 0, path: 'src/a.ts', side: 'head', line: 10, column: 6, length: 5 },
      { fileIndex: 0, path: 'src/a.ts', side: 'base', line: 11, column: 4, length: 5 },
      { fileIndex: 0, path: 'src/a.ts', side: 'head', line: 11, column: 6, length: 5 },
      { fileIndex: 1, path: 'src/b.ts', side: 'head', line: 1, column: 0, length: 5 },
      { fileIndex: 1, path: 'src/b.ts', side: 'head', line: 1, column: 6, length: 5 },
    ]);
  });

  test('matches case only when asked', ({ expect }) => {
    const hits = findInReview(files(), 'Total', { isCaseSensitive: true });
    expect(hits.map((hit) => [hit.path, hit.side, hit.line])).toStrictEqual([
      ['src/a.ts', 'base', 11],
    ]);
  });

  test('ignores the git and hunk headers', ({ expect }) => {
    expect(findInReview(files(), 'diff --git')).toStrictEqual([]);
    expect(findInReview(files(), '@@')).toStrictEqual([]);
    expect(findInReview(files(), 'a/src')).toStrictEqual([]);
  });

  test('numbers lines across hunks and skips "no newline" markers', ({ expect }) => {
    const file = {
      ...createDiffFileView('x.ts', ['-a']),
      patch: [
        'diff --git a/x.ts b/x.ts',
        '--- a/x.ts',
        '+++ b/x.ts',
        '@@ -1,2 +1,2 @@',
        ' keep',
        '-old',
        '\\ No newline at end of file',
        '+new hit',
        '@@ -40 +40,2 @@ function f() {',
        ' hit',
        '+hit again',
        '',
      ].join('\n'),
    };
    expect(findInReview([file], 'hit').map((hit) => [hit.side, hit.line])).toStrictEqual([
      ['head', 2],
      ['head', 40],
      ['head', 41],
    ]);
  });

  test('stops at the limit and finds nothing for an empty query', ({ expect }) => {
    expect(findInReview(files(), 'total', { limit: 2 })).toHaveLength(2);
    expect(findInReview(files(), '')).toStrictEqual([]);
  });
});
