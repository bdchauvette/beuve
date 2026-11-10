import { describe } from 'vitest';

import { splitPatchHunks } from './split-patch-hunks.ts';
import { test } from './testing/test.ts';

describe('splitPatchHunks', () => {
  test('splits at hunk headers, keeping each line’s newline', ({ expect }) => {
    const patch = '--- a/a\n+++ b/a\n@@ -1 +1 @@\n-a\n+b\n@@ -9 +9,2 @@\n+@@ -1 +1 @@\n c\n';
    expect(splitPatchHunks(patch)).toStrictEqual({
      preamble: '--- a/a\n+++ b/a\n',
      hunks: ['@@ -1 +1 @@\n-a\n+b\n', '@@ -9 +9,2 @@\n+@@ -1 +1 @@\n c\n'],
    });
  });

  test('a patch without hunks is all preamble', ({ expect }) => {
    expect(splitPatchHunks('Binary files differ\n')).toStrictEqual({
      preamble: 'Binary files differ\n',
      hunks: [],
    });
  });
});
