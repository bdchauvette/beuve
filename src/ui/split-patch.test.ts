import { describe, expect, it } from 'vitest';

import { splitPatch } from './split-patch.ts';

describe('splitPatch', () => {
  it('classifies header, hunk, change and note lines', () => {
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
    expect(splitPatch(patch).map(({ kind }) => kind)).toEqual([
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

  it('treats a binary patch as header only', () => {
    expect(splitPatch('diff --git a/x b/x\nBinary files a/x and b/x differ\n')).toEqual([
      { kind: 'meta', text: 'diff --git a/x b/x' },
      { kind: 'meta', text: 'Binary files a/x and b/x differ' },
    ]);
  });
});
