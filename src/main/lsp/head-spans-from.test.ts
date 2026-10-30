import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';
import { parseUnifiedDiff } from '#internal/git/parse-unified-diff.ts';

import { headSpansFrom } from './head-spans-from.ts';
import { test } from '../testing/test.ts';

function patch(): string {
  return [
    'diff --git a/a.ts b/a.ts',
    'index 1111111111111111111111111111111111111111..2222222222222222222222222222222222222222 100644',
    '--- a/a.ts',
    '+++ b/a.ts',
    '@@ -1,4 +1,6 @@',
    ' one',
    '+two',
    '+three',
    ' four',
    '-five',
    ' six',
    '+seven',
    '@@ -40,2 +41,0 @@',
    '-gone',
    '-also gone',
    'diff --git a/old.ts b/old.ts',
    'deleted file mode 100644',
    'index 3333333333333333333333333333333333333333..0000000000000000000000000000000000000000',
    '--- a/old.ts',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-x',
    '',
  ].join('\n');
}

describe('headSpansFrom', () => {
  test('spans added runs and the head lines around deletions, skipping deleted files', ({
    expect,
  }) => {
    const parsed = okValueFrom(parseUnifiedDiff(patch()));
    expect(headSpansFrom(parsed)).toStrictEqual(
      new Map([
        [
          'a.ts',
          [
            { startLine: 2, endLine: 6 },
            { startLine: 41, endLine: 42 },
          ],
        ],
      ]),
    );
  });
});
