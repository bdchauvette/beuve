import { describe, expect, it } from 'vitest';

import { parseUnifiedDiff } from '#internal/git/parse-unified-diff.ts';

import { toChangedLines } from './to-changed-lines.ts';

const patch = [
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

describe('toChangedLines', () => {
  it('merges removed lines by base number and added lines by head number into runs', () => {
    const parsed = parseUnifiedDiff(patch);
    if (!parsed.ok || parsed.value[0] === undefined) {
      throw new Error('fixture does not parse');
    }
    expect(toChangedLines(parsed.value[0])).toEqual({
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

  it('is empty for a file without hunks', () => {
    expect(toChangedLines({ hunks: [] })).toEqual({ base: [], head: [] });
  });
});
