import { describe } from 'vitest';

import { parseHunkRanges } from './parse-hunk-ranges.ts';
import { test } from './testing/test.ts';

describe('parseHunkRanges', () => {
  test('reads the head span of every hunk', ({ expect }) => {
    const patch = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1,3 +1,4 @@ function a() {',
      ' x',
      '+@@ -9,9 +9,9 @@ added text that looks like a header',
      ' y',
      ' z',
      '@@ -20 +21 @@',
      '-old',
      '+new',
      '',
    ].join('\n');
    expect(parseHunkRanges(patch)).toStrictEqual([
      { start: 1, end: 4 },
      { start: 21, end: 21 },
    ]);
  });

  test('anchors deletion-only hunks to the preceding head line', ({ expect }) => {
    expect(parseHunkRanges('@@ -5,2 +4,0 @@\n-a\n-b\n')).toStrictEqual([{ start: 4, end: 4 }]);
    expect(parseHunkRanges('@@ -1,2 +0,0 @@\n-a\n-b\n')).toStrictEqual([{ start: 1, end: 1 }]);
  });

  test('finds nothing in binary or empty patches', ({ expect }) => {
    expect(parseHunkRanges('diff --git a/x b/x\nBinary files a/x and b/x differ\n')).toStrictEqual(
      [],
    );
    expect(parseHunkRanges('')).toStrictEqual([]);
  });
});
