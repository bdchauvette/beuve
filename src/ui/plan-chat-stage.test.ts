import { describe, expect, it } from 'vitest';

import type { ChatMessageView } from '#contract/ipc-contract.ts';

import type { ChatEntry } from './chat-entry.ts';
import { planChatStage } from './plan-chat-stage.ts';

const base = { sessionId: 's1', headSha: 'b'.repeat(40), createdAt: '2026-10-28T12:00:00.000Z' };
const diff = new Set(['src/a.ts']);

describe('planChatStage', () => {
  it('anchors on the first citation inside the diff and titles the note with the question', () => {
    const entries = [
      ask('  Why does\n parse trim?  '),
      reply({
        content: 'See [[lib/x.ts:9-9]] then [[src/a.ts:12-13]].',
        citations: [
          { path: 'lib/x.ts', startLine: 9, endLine: 9 },
          { path: 'src/a.ts', startLine: 12, endLine: 13 },
        ],
      }),
    ];
    expect(planChatStage(entries, 'a', diff)).toEqual({
      messageId: 'a',
      headSha: 'b'.repeat(40),
      anchor: { kind: 'lines', path: 'src/a.ts', startLine: 12, endLine: 13 },
      severity: 'question',
      title: 'Why does parse trim?',
      body: 'See `lib/x.ts:9-9` then `src/a.ts:12-13`.',
    });
  });

  it('anchors on the whole change when nothing cited is in the diff', () => {
    const entries = [
      ask('Anything else?'),
      reply({ citations: [{ path: 'lib/x.ts', startLine: 1, endLine: 2 }] }),
    ];
    expect(planChatStage(entries, 'a', diff)).toMatchObject({ anchor: { kind: 'change' } });
    expect(planChatStage([ask('Anything?'), reply({})], 'a', diff)).toMatchObject({
      anchor: { kind: 'change' },
    });
  });

  it('shortens a long question to a one-line title', () => {
    const plan = planChatStage([ask(`${'word '.repeat(60)}?`), reply({})], 'a', diff);
    expect(plan?.title).toHaveLength(100);
    expect(plan?.title.endsWith('…')).toBe(true);
  });

  it('plans nothing for unfinished answers, questions, blank answers or unknown messages', () => {
    expect(planChatStage([ask('q'), reply({ status: 'streaming' })], 'a', diff)).toBeUndefined();
    expect(planChatStage([ask('q'), reply({ status: 'cancelled' })], 'a', diff)).toBeUndefined();
    expect(planChatStage([ask('q'), reply({ content: '  ' })], 'a', diff)).toBeUndefined();
    expect(planChatStage([ask('q'), reply({})], 'q', diff)).toBeUndefined();
    expect(planChatStage([ask('q')], 'zzz', diff)).toBeUndefined();
  });

  it('titles a /summarize answer as the summary, and leaves /review answers to their findings', () => {
    const summary = planChatStage(
      [ask('/summarize'), reply({ answerKind: 'abstract' })],
      'a',
      diff,
    );
    expect(summary?.title).toBe('Summary of the change (beuve, from the diff)');
    expect(planChatStage([ask('/review'), reply({ answerKind: 'review' })], 'a', diff)).toBe(
      undefined,
    );
  });

  it('falls back to a generic title when the question is not listed', () => {
    expect(planChatStage([reply({})], 'a', diff)?.title).toBe('Question from the chat');
  });
});

function entry(message: ChatMessageView): ChatEntry {
  return { id: message.id, kind: 'message', message };
}

function ask(content: string): ChatEntry {
  return entry({
    ...base,
    id: 'q',
    role: 'user',
    content,
    citations: [],
    mentions: [],
    status: 'complete',
  });
}

function reply(overrides: Partial<ChatMessageView>): ChatEntry {
  return entry({
    ...base,
    id: 'a',
    role: 'assistant',
    content: 'Because.',
    citations: [],
    mentions: [],
    status: 'complete',
    ...overrides,
  });
}
