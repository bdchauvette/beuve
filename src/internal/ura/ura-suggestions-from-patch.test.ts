import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { parseSuggestedPatch } from './parse-suggested-patch.ts';
import { uraSuggestionsFromPatch } from './ura-suggestions-from-patch.ts';
import { test } from './testing/test.ts';

describe('uraSuggestionsFromPatch', () => {
  test('makes each hunk a suggestion over its old range, replaced by its new side', ({
    expect,
  }) => {
    const patch = okValueFrom(
      parseSuggestedPatch(
        [
          '@@ -10,3 +10,4 @@',
          ' a',
          '-b',
          '+B',
          '+B2',
          ' c',
          '@@ -20,0 +21,1 @@',
          '+after twenty',
          '@@ -30,2 +31,0 @@',
          '-x',
          '-y',
          '',
        ].join('\n'),
        { kind: 'file', path: 'src/a.ts' },
      ),
    );
    expect(uraSuggestionsFromPatch(patch)).toStrictEqual([
      { path: 'src/a.ts', startLine: 10, endLine: 12, replacement: 'a\nB\nB2\nc' },
      { path: 'src/a.ts', startLine: 21, endLine: 20, replacement: 'after twenty' },
      { path: 'src/a.ts', startLine: 30, endLine: 31, replacement: '' },
    ]);
  });
});
