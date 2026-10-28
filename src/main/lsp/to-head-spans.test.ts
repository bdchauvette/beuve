import { describe, expect, it } from 'vitest';

import { parseUnifiedDiff } from '#internal/git/parse-unified-diff.ts';

import { toHeadSpans } from './to-head-spans.ts';

const patch = [
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

describe('toHeadSpans', () => {
  it('spans added runs and the head lines around deletions, skipping deleted files', () => {
    const parsed = parseUnifiedDiff(patch);
    if (!parsed.ok) {
      throw new Error(parsed.error.message);
    }
    expect(toHeadSpans(parsed.value)).toEqual(
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
