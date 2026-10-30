import { describe } from 'vitest';

import { test } from './testing/test.ts';

import type { ChatMentionView } from '#contract/ipc-contract.ts';

import { serializeChatDraft } from './serialize-chat-draft.ts';
import { draftPartsFrom } from './draft-parts-from.ts';

function sha(): string {
  return 'c'.repeat(40);
}
function head(): ChatMentionView {
  return { path: 'a.ts', side: 'head', startLine: 2, endLine: 4, sha: sha() };
}
function base(): ChatMentionView {
  return { path: 'a.ts', side: 'base', startLine: 2, endLine: 3, sha: sha() };
}

describe('serializeChatDraft', () => {
  test('numbers chips in order, names a repeated one by its first number, and trims', ({
    expect,
  }) => {
    expect(
      serializeChatDraft([
        { kind: 'text', text: '  Why ' },
        { kind: 'mention', mention: head() },
        { kind: 'text', text: ' not ' },
        { kind: 'mention', mention: base() },
        { kind: 'text', text: ', like ' },
        { kind: 'mention', mention: { ...head() } },
        { kind: 'text', text: '? ' },
      ]),
    ).toStrictEqual({ text: 'Why [[@1]] not [[@2]], like [[@1]]?', mentions: [head(), base()] });
  });

  test('keeps typed look-alike tokens from becoming mentions', ({ expect }) => {
    expect(serializeChatDraft([{ kind: 'text', text: 'is [[@1]] a token?' }])).toStrictEqual({
      text: 'is [[ @1]] a token?',
      mentions: [],
    });
  });

  test('round-trips through draftPartsFrom', ({ expect }) => {
    const { text, mentions } = serializeChatDraft([
      { kind: 'mention', mention: head() },
      { kind: 'text', text: ' vs ' },
      { kind: 'mention', mention: base() },
    ]);
    expect(draftPartsFrom(text, mentions)).toStrictEqual([
      { kind: 'mention', mention: head() },
      { kind: 'text', text: ' vs ' },
      { kind: 'mention', mention: base() },
    ]);
    expect(draftPartsFrom('stray [[@3]] token', mentions)).toStrictEqual([
      { kind: 'text', text: 'stray [[@3]] token' },
    ]);
  });
});
