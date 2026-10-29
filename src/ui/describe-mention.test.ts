import { describe, expect, it } from 'vitest';

import { describeMention } from './describe-mention.ts';

describe('describeMention', () => {
  it('labels a chip with the file name and lines, marking the base side', () => {
    expect(
      describeMention({
        path: 'src/pricing/discounts.ts',
        side: 'head',
        startLine: 27,
        endLine: 33,
        sha: 'abcdef0123'.repeat(4),
      }),
    ).toEqual({
      label: 'discounts.ts:27-33',
      title: 'src/pricing/discounts.ts, lines 27-33, head at abcdef01',
    });
    expect(describeMention({ path: 'a/b.ts', side: 'base', startLine: 4, endLine: 4 })).toEqual({
      label: 'base:b.ts:4',
      title: 'a/b.ts, line 4, base side',
    });
    expect(describeMention({ path: 'README.md', side: 'head' }).label).toBe('README.md');
  });
});
