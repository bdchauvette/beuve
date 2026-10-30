import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { describeCitation } from './describe-citation.ts';

describe('describeCitation', () => {
  test('shows the file name and the line range, with the whole path as the title', ({ expect }) => {
    expect(describeCitation({ path: 'src/ui/a.ts', startLine: 12, endLine: 18 })).toStrictEqual({
      label: 'a.ts:12-18',
      title: 'src/ui/a.ts:12-18',
    });
  });

  test('shows a single line once', ({ expect }) => {
    expect(describeCitation({ path: 'Makefile', startLine: 3, endLine: 3 })).toStrictEqual({
      label: 'Makefile:3',
      title: 'Makefile:3',
    });
  });
});
