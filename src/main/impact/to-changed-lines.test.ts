import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';
import { parseUnifiedDiff } from '#internal/git/parse-unified-diff.ts';

import { toChangedLines } from './to-changed-lines.ts';
import { test } from '../testing/test.ts';

function patch(): string {
  return [
    'diff --git a/a.ts b/a.ts',
    'index 1111111111111111111111111111111111111111..2222222222222222222222222222222222222222 100644',
    '--- a/a.ts',
    '+++ b/a.ts',
    '@@ -1,6 +1,5 @@',
    ' one',
    '-two',
    '-three',
    '+TWO',
    ' four',
    '+four and a half',
    ' five',
    '-six',
    '@@ -20,2 +19,4 @@',
    ' twenty',
    '+twenty-one',
    '+twenty-two',
    ' twenty-three',
    '',
  ].join('\n');
}

describe('toChangedLines', () => {
  test('merges removed lines by base number and added lines by head number into runs', ({
    expect,
  }) => {
    const [file] = okValueFrom(parseUnifiedDiff(patch()));
    expect(toChangedLines(file ?? { hunks: [] })).toStrictEqual({
      base: [
        { start: 2, end: 3 },
        { start: 6, end: 6 },
      ],
      head: [
        { start: 2, end: 2 },
        { start: 4, end: 4 },
        { start: 20, end: 21 },
      ],
    });
  });

  test('is empty for a file without hunks', ({ expect }) => {
    expect(toChangedLines({ hunks: [] })).toStrictEqual({ base: [], head: [] });
  });
});
