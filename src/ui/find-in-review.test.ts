import { describe, expect, it } from 'vitest';

import { findInReview } from './find-in-review.ts';
import { createDiffFileView } from './testing/create-diff-file-view.ts';

const files = [
  createDiffFileView('src/a.ts', [' const total = 1;', '-let Total = 2;', '+const total = 3;'], 10),
  createDiffFileView('src/b.ts', ['+total total', ' unchanged'], 1),
];

describe('findInReview', () => {
  it('finds every hit in stream order with its side and line number', () => {
    expect(findInReview(files, 'total')).toEqual([
      { fileIndex: 0, path: 'src/a.ts', side: 'head', line: 10, column: 6, length: 5 },
      { fileIndex: 0, path: 'src/a.ts', side: 'base', line: 11, column: 4, length: 5 },
      { fileIndex: 0, path: 'src/a.ts', side: 'head', line: 11, column: 6, length: 5 },
      { fileIndex: 1, path: 'src/b.ts', side: 'head', line: 1, column: 0, length: 5 },
      { fileIndex: 1, path: 'src/b.ts', side: 'head', line: 1, column: 6, length: 5 },
    ]);
  });

  it('matches case only when asked', () => {
    const hits = findInReview(files, 'Total', { isCaseSensitive: true });
    expect(hits.map((hit) => [hit.path, hit.side, hit.line])).toEqual([['src/a.ts', 'base', 11]]);
  });

  it('ignores the git and hunk headers', () => {
    expect(findInReview(files, 'diff --git')).toEqual([]);
    expect(findInReview(files, '@@')).toEqual([]);
    expect(findInReview(files, 'a/src')).toEqual([]);
  });

  it('numbers lines across hunks and skips "no newline" markers', () => {
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
    expect(findInReview([file], 'hit').map((hit) => [hit.side, hit.line])).toEqual([
      ['head', 2],
      ['head', 40],
      ['head', 41],
    ]);
  });

  it('stops at the limit and finds nothing for an empty query', () => {
    expect(findInReview(files, 'total', { limit: 2 })).toHaveLength(2);
    expect(findInReview(files, '')).toEqual([]);
  });
});
