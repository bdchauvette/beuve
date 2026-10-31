import { describe } from 'vitest';

import { test } from './testing/test.ts';

import type { ChatMentionView } from '#contract/ipc-contract.ts';

import type { DraftPart } from './chat-draft.ts';
import { insertDraftMention } from './insert-draft-mention.ts';

function mention(): ChatMentionView {
  return {
    path: 'src/discounts.ts',
    side: 'head',
    startLine: 27,
    endLine: 33,
    sha: 'c'.repeat(40),
  };
}
function chip(): DraftPart {
  return { kind: 'mention', mention: mention() };
}

describe('insertDraftMention', () => {
  test('puts a chip into an empty input with a space after it', ({ expect }) => {
    expect(insertDraftMention({ parts: [], caret: 0 }, mention())).toStrictEqual({
      parts: [chip(), { kind: 'text', text: ' ' }],
      caret: 2,
    });
  });

  test('splits the text at the caret, spacing the chip from words on either side', ({ expect }) => {
    const state = { parts: [{ kind: 'text', text: 'Why doesround?' }] as const, caret: 8 };
    expect(insertDraftMention(state, mention())).toStrictEqual({
      parts: [{ kind: 'text', text: 'Why does ' }, chip(), { kind: 'text', text: ' round?' }],
      caret: 11,
    });
  });

  test('reuses spaces already there, and lands after another chip', ({ expect }) => {
    const state = {
      parts: [{ kind: 'text', text: 'Compare ' }, chip(), { kind: 'text', text: ' with' }] as const,
      caret: 9,
    };
    const other = { ...mention(), side: 'base' } as const;
    expect(insertDraftMention(state, other)).toStrictEqual({
      parts: [
        { kind: 'text', text: 'Compare ' },
        chip(),
        { kind: 'text', text: ' ' },
        { kind: 'mention', mention: other },
        { kind: 'text', text: ' with' },
      ],
      caret: 12,
    });
  });

  test('appends at the end when the caret is past it', ({ expect }) => {
    const state = { parts: [{ kind: 'text', text: 'See' }] as const, caret: 99 };
    expect(insertDraftMention(state, mention())).toStrictEqual({
      parts: [{ kind: 'text', text: 'See ' }, chip(), { kind: 'text', text: ' ' }],
      caret: 6,
    });
  });
});
