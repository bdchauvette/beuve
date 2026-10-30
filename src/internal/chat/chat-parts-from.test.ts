import { describe } from 'vitest';

import type { ChatMention, CommitSha } from './chat-message.ts';
import { chatMentionsFrom } from './chat-mentions-from.ts';
import { chatPartsFrom } from './chat-parts-from.ts';
import { chatTextFrom } from './chat-text-from.ts';
import { test } from './testing/test.ts';

describe('chatPartsFrom', () => {
  test('splits a question at the tokens that name its mentions', ({ expect }) => {
    expect(chatPartsFrom('Why [[@1]] and not [[@2]]?', [first(), second()])).toStrictEqual([
      { kind: 'text', id: 'p1', text: 'Why ' },
      { kind: 'mention', id: 'p2', mention: first() },
      { kind: 'text', id: 'p3', text: ' and not ' },
      { kind: 'mention', id: 'p4', mention: second() },
      { kind: 'text', id: 'p5', text: '?' },
    ]);
  });

  test('keeps a token that names nothing, and adds mentions no token names', ({ expect }) => {
    expect(chatPartsFrom('See [[@3]]', [first()])).toStrictEqual([
      { kind: 'text', id: 'p1', text: 'See [[@3]]' },
      { kind: 'mention', id: 'p2', mention: first() },
    ]);
    expect(chatPartsFrom('')).toStrictEqual([]);
    expect(chatPartsFrom('[[@1]]', [first()])).toStrictEqual([
      { kind: 'mention', id: 'p1', mention: first() },
    ]);
  });
});

describe('chatTextFrom and chatMentionsFrom', () => {
  test('give back the text and mentions a question was made from', ({ expect }) => {
    const parts = chatPartsFrom('Why [[@1]] and not [[@2]]?', [first(), second()]);
    expect(chatTextFrom(parts)).toBe('Why [[@1]] and not [[@2]]?');
    expect(chatMentionsFrom(parts)).toStrictEqual([first(), second()]);
  });

  test('number a repeated mention once and skip parts that are not text', ({ expect }) => {
    const parts = chatPartsFrom('[[@1]] vs [[@2]] vs [[@3]]', [first(), second(), first()]);
    expect(chatTextFrom(parts)).toBe('[[@1]] vs [[@2]] vs [[@1]]');
    expect(chatMentionsFrom(parts)).toStrictEqual([first(), second()]);
    expect(
      chatTextFrom([
        { kind: 'reasoning', id: 'p1', state: 'done' },
        { kind: 'tool-call', id: 'p2', tool: 'Read', description: 'read a.ts', state: 'done' },
        { kind: 'text', id: 'p3', text: 'Answer' },
        { kind: 'error', id: 'p4', code: 'timeout' },
      ]),
    ).toBe('Answer');
  });
});

function first(): ChatMention {
  return { path: 'a.ts', side: 'head', startLine: 2, endLine: 3, sha: 'c'.repeat(40) as CommitSha };
}

function second(): ChatMention {
  return { path: 'old.ts', side: 'base', sha: 'b'.repeat(40) as CommitSha };
}
