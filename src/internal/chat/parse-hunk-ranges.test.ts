import { describe, expect, it } from 'vitest';

import { parseHunkRanges } from './parse-hunk-ranges.ts';

describe('parseHunkRanges', () => {
  it('reads the head span of every hunk', () => {
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
    expect(parseHunkRanges(patch)).toEqual([
      { start: 1, end: 4 },
      { start: 21, end: 21 },
    ]);
  });

  it('anchors deletion-only hunks to the preceding head line', () => {
    expect(parseHunkRanges('@@ -5,2 +4,0 @@\n-a\n-b\n')).toEqual([{ start: 4, end: 4 }]);
    expect(parseHunkRanges('@@ -1,2 +0,0 @@\n-a\n-b\n')).toEqual([{ start: 1, end: 1 }]);
  });

  it('finds nothing in binary or empty patches', () => {
    expect(parseHunkRanges('diff --git a/x b/x\nBinary files a/x and b/x differ\n')).toEqual([]);
    expect(parseHunkRanges('')).toEqual([]);
  });
});
