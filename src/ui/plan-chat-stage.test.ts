import { describe } from 'vitest';

import { test } from './testing/test.ts';

import type { ChatMessageView } from '#contract/ipc-contract.ts';

import type { ChatEntry } from './chat-entry.ts';
import { planChatStage } from './plan-chat-stage.ts';

/** The fields every message in these tests shares. */
type MessageBase = Pick<ChatMessageView, 'sessionId' | 'headSha' | 'createdAt'>;

/** A reply's fields, with its whole text in place of parts. */
type ReplyFields = Partial<ChatMessageView> & { readonly text?: string };

function base(): MessageBase {
  return { sessionId: 's1', headSha: 'b'.repeat(40), createdAt: '2026-10-28T12:00:00.000Z' };
}
function diff(): Set<string> {
  return new Set(['src/a.ts']);
}

describe('planChatStage', () => {
  test('anchors on the first citation inside the diff and titles the note with the question', ({
    expect,
  }) => {
    const entries = [
      ask('  Why does\n parse trim?  '),
      reply({
        text: 'See [[lib/x.ts:9-9]] then [[src/a.ts:12-13]].',
        citations: [
          { path: 'lib/x.ts', startLine: 9, endLine: 9 },
          { path: 'src/a.ts', startLine: 12, endLine: 13 },
        ],
      }),
    ];
    expect(planChatStage(entries, 'a', diff())).toStrictEqual({
      messageId: 'a',
      headSha: 'b'.repeat(40),
      anchor: { kind: 'lines', path: 'src/a.ts', startLine: 12, endLine: 13 },
      severity: 'question',
      title: 'Why does parse trim?',
      body: 'See `lib/x.ts:9-9` then `src/a.ts:12-13`.',
    });
  });

  test('anchors on the whole change when nothing cited is in the diff', ({ expect }) => {
    const entries = [
      ask('Anything else?'),
      reply({ citations: [{ path: 'lib/x.ts', startLine: 1, endLine: 2 }] }),
    ];
    expect(planChatStage(entries, 'a', diff())).toMatchObject({ anchor: { kind: 'change' } });
    expect(planChatStage([ask('Anything?'), reply({})], 'a', diff())).toMatchObject({
      anchor: { kind: 'change' },
    });
  });

  test('shortens a long question to a one-line title', ({ expect }) => {
    const plan = planChatStage([ask(`${'word '.repeat(60)}?`), reply({})], 'a', diff());
    expect(plan?.title).toHaveLength(100);
    expect(plan?.title.endsWith('…')).toBe(true);
  });

  test('plans nothing for unfinished answers, questions, blank answers or unknown messages', ({
    expect,
  }) => {
    expect(planChatStage([ask('q'), reply({ status: 'streaming' })], 'a', diff())).toBeUndefined();
    expect(planChatStage([ask('q'), reply({ status: 'cancelled' })], 'a', diff())).toBeUndefined();
    expect(planChatStage([ask('q'), reply({ text: '  ' })], 'a', diff())).toBeUndefined();
    expect(planChatStage([ask('q'), reply({})], 'q', diff())).toBeUndefined();
    expect(planChatStage([ask('q')], 'zzz', diff())).toBeUndefined();
  });

  test('titles a /summarize answer as the summary, and leaves /review answers to their findings', ({
    expect,
  }) => {
    const summary = planChatStage(
      [ask('/summarize'), reply({ answerKind: 'abstract' })],
      'a',
      diff(),
    );
    expect(summary?.title).toBe('Summary of the change (beuve, from the diff)');
    expect(
      planChatStage([ask('/review'), reply({ answerKind: 'review' })], 'a', diff()),
    ).toBeUndefined();
  });

  test('falls back to a generic title when the question is not listed', ({ expect }) => {
    expect(planChatStage([reply({})], 'a', diff())?.title).toBe('Question from the chat');
  });
});

function entry(message: ChatMessageView): ChatEntry {
  return { id: message.id, kind: 'message', message };
}

function ask(content: string): ChatEntry {
  return entry({
    ...base(),
    id: 'q',
    role: 'user',
    parts: [{ kind: 'text', id: 'p1', text: content }],
    citations: [],
    status: 'done',
  });
}

function reply({ text = 'Because.', ...overrides }: ReplyFields): ChatEntry {
  return entry({
    ...base(),
    id: 'a',
    role: 'assistant',
    parts: [{ kind: 'text', id: 'p1', text }],
    citations: [],
    status: 'done',
    ...overrides,
  });
}
