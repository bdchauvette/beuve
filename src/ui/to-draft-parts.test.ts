import { describe, expect, it } from 'vitest';

import type { ChatMentionView } from '#contract/ipc-contract.ts';

import { toDraftParts } from './to-draft-parts.ts';

const mention: ChatMentionView = { path: 'a.ts', side: 'head', sha: 'c'.repeat(40) };

describe('toDraftParts', () => {
  it('turns the tokens naming a mention into chips and keeps the rest as text', () => {
    expect(toDraftParts('Why [[@1]] and [[@2]]? [[@1]]', [mention])).toEqual([
      { kind: 'text', text: 'Why ' },
      { kind: 'mention', mention },
      { kind: 'text', text: ' and [[@2]]? ' },
      { kind: 'mention', mention },
    ]);
    expect(toDraftParts('plain', [])).toEqual([{ kind: 'text', text: 'plain' }]);
    expect(toDraftParts('', [mention])).toEqual([]);
  });
});
