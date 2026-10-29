import { describe, expect, it } from 'vitest';

import type { ChatMentionView } from '#contract/ipc-contract.ts';

import { serializeChatDraft } from './serialize-chat-draft.ts';
import { toDraftParts } from './to-draft-parts.ts';

const sha = 'c'.repeat(40);
const head: ChatMentionView = { path: 'a.ts', side: 'head', startLine: 2, endLine: 4, sha };
const base: ChatMentionView = { path: 'a.ts', side: 'base', startLine: 2, endLine: 3, sha };

describe('serializeChatDraft', () => {
  it('numbers chips in order, names a repeated one by its first number, and trims', () => {
    expect(
      serializeChatDraft([
        { kind: 'text', text: '  Why ' },
        { kind: 'mention', mention: head },
        { kind: 'text', text: ' not ' },
        { kind: 'mention', mention: base },
        { kind: 'text', text: ', like ' },
        { kind: 'mention', mention: { ...head } },
        { kind: 'text', text: '? ' },
      ]),
    ).toEqual({ text: 'Why [[@1]] not [[@2]], like [[@1]]?', mentions: [head, base] });
  });

  it('keeps typed look-alike tokens from becoming mentions', () => {
    expect(serializeChatDraft([{ kind: 'text', text: 'is [[@1]] a token?' }])).toEqual({
      text: 'is [[ @1]] a token?',
      mentions: [],
    });
  });

  it('round-trips through toDraftParts', () => {
    const { text, mentions } = serializeChatDraft([
      { kind: 'mention', mention: head },
      { kind: 'text', text: ' vs ' },
      { kind: 'mention', mention: base },
    ]);
    expect(toDraftParts(text, mentions)).toEqual([
      { kind: 'mention', mention: head },
      { kind: 'text', text: ' vs ' },
      { kind: 'mention', mention: base },
    ]);
    expect(toDraftParts('stray [[@3]] token', mentions)).toEqual([
      { kind: 'text', text: 'stray [[@3]] token' },
    ]);
  });
});
