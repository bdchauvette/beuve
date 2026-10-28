import { describe, expect, it } from 'vitest';

import { describeCitation } from './describe-citation.ts';

describe('describeCitation', () => {
  it('shows the file name and the line range, with the whole path as the title', () => {
    expect(describeCitation({ path: 'src/ui/a.ts', startLine: 12, endLine: 18 })).toEqual({
      label: 'a.ts:12-18',
      title: 'src/ui/a.ts:12-18',
    });
  });

  it('shows a single line once', () => {
    expect(describeCitation({ path: 'Makefile', startLine: 3, endLine: 3 })).toEqual({
      label: 'Makefile:3',
      title: 'Makefile:3',
    });
  });
});
