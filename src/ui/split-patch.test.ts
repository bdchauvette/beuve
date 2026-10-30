import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { splitPatch } from './split-patch.ts';

describe('splitPatch', () => {
  test('classifies header, hunk, change and note lines', ({ expect }) => {
    const patch = [
      'diff --git a/a.txt b/a.txt',
      'index 1111111..2222222 100644',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1,2 +1,2 @@ fn main',
      ' same',
      '-old',
      '+new',
      String.raw`\ No newline at end of file`,
      '',
    ].join('\n');
    expect(splitPatch(patch).map(({ kind }) => kind)).toStrictEqual([
      'meta',
      'meta',
      'meta',
      'meta',
      'hunk',
      'context',
      'removed',
      'added',
      'note',
    ]);
  });

  test('treats a binary patch as header only', ({ expect }) => {
    expect(splitPatch('diff --git a/x b/x\nBinary files a/x and b/x differ\n')).toStrictEqual([
      { kind: 'meta', text: 'diff --git a/x b/x' },
      { kind: 'meta', text: 'Binary files a/x and b/x differ' },
    ]);
  });
});
