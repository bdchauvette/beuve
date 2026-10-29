import { describe, expect, it } from 'vitest';

import type { ChatMentionView } from '#contract/ipc-contract.ts';

import { insertDraftMention } from './insert-draft-mention.ts';

const mention: ChatMentionView = {
  path: 'src/discounts.ts',
  side: 'head',
  startLine: 27,
  endLine: 33,
  sha: 'c'.repeat(40),
};
const chip = { kind: 'mention', mention } as const;

describe('insertDraftMention', () => {
  it('puts a chip into an empty input with a space after it', () => {
    expect(insertDraftMention({ parts: [], caret: 0 }, mention)).toEqual({
      parts: [chip, { kind: 'text', text: ' ' }],
      caret: 2,
    });
  });

  it('splits the text at the caret, spacing the chip from words on either side', () => {
    const state = { parts: [{ kind: 'text', text: 'Why doesround?' }] as const, caret: 8 };
    expect(insertDraftMention(state, mention)).toEqual({
      parts: [{ kind: 'text', text: 'Why does ' }, chip, { kind: 'text', text: ' round?' }],
      caret: 11,
    });
  });

  it('reuses spaces already there, and lands after another chip', () => {
    const state = {
      parts: [{ kind: 'text', text: 'Compare ' }, chip, { kind: 'text', text: ' with' }] as const,
      caret: 9,
    };
    const other = { ...mention, side: 'base' } as const;
    expect(insertDraftMention(state, other)).toEqual({
      parts: [
        { kind: 'text', text: 'Compare ' },
        chip,
        { kind: 'text', text: ' ' },
        { kind: 'mention', mention: other },
        { kind: 'text', text: ' with' },
      ],
      caret: 12,
    });
  });

  it('appends at the end when the caret is past it', () => {
    const state = { parts: [{ kind: 'text', text: 'See' }] as const, caret: 99 };
    expect(insertDraftMention(state, mention)).toEqual({
      parts: [{ kind: 'text', text: 'See ' }, chip, { kind: 'text', text: ' ' }],
      caret: 6,
    });
  });
});
