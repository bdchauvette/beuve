import { describe, expect, it } from 'vitest';

import { expandMentionTokens } from './expand-mention-tokens.ts';

describe('expandMentionTokens', () => {
  const mentions = [
    { path: 'src/discounts.ts', side: 'head', startLine: 27, endLine: 33 },
    { path: 'src/old.ts', side: 'base', startLine: 4, endLine: 4 },
    { path: 'README.md', side: 'head' },
  ] as const;

  it('names each mention by its number', () => {
    expect(expandMentionTokens('Why [[@1]] and not [[@2]]? See [[@3]].', mentions)).toBe(
      'Why «selection 1: src/discounts.ts:27-33» and not «selection 2: base:src/old.ts:4»? ' +
        'See «selection 3: README.md».',
    );
  });

  it('leaves tokens past the last mention, and other brackets, as typed', () => {
    expect(expandMentionTokens('[[@4]] [[@0]] [[a.ts:1]]', mentions)).toBe(
      '[[@4]] [[@0]] [[a.ts:1]]',
    );
  });
});
