import { describe } from 'vitest';

import { test } from './testing/test.ts';

import type { ChatMentionView } from '#contract/ipc-contract.ts';

import { toDraftParts } from './to-draft-parts.ts';

function mention(): ChatMentionView {
  return { path: 'a.ts', side: 'head', sha: 'c'.repeat(40) };
}

describe('toDraftParts', () => {
  test('turns the tokens naming a mention into chips and keeps the rest as text', ({ expect }) => {
    expect(toDraftParts('Why [[@1]] and [[@2]]? [[@1]]', [mention()])).toStrictEqual([
      { kind: 'text', text: 'Why ' },
      { kind: 'mention', mention: mention() },
      { kind: 'text', text: ' and [[@2]]? ' },
      { kind: 'mention', mention: mention() },
    ]);
    expect(toDraftParts('plain', [])).toStrictEqual([{ kind: 'text', text: 'plain' }]);
    expect(toDraftParts('', [mention()])).toStrictEqual([]);
  });
});
