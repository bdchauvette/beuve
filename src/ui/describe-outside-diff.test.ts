import { describe } from 'vitest';

import { describeOutsideDiff } from './describe-outside-diff.ts';
import { test } from './testing/test.ts';

describe('describeOutsideDiff', () => {
  test('names the place and says the review leaves it unchanged', ({ expect }) => {
    expect(describeOutsideDiff('src/a.ts:3-4')).toBe(
      'src/a.ts:3-4 is not in this diff: the file is unchanged by the review.',
    );
  });

  test('shows bidi and invisible characters in the path', ({ expect }) => {
    // U+202E, a right-to-left override, written as a JSON escape so no source line carries it.
    const path = JSON.parse('"a\\u202eb.ts"') as string;
    expect(describeOutsideDiff(path)).toContain('⟨U+202E⟩');
  });
});
