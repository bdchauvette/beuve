import type { DatabaseSync } from 'node:sqlite';

import { describe } from 'vitest';

import { appendChatMessage } from './append-chat-message.ts';
import type { ChatMessage, ChatMessageId, CommitSha, SessionId } from './chat-message.ts';
import { chatPartsFrom } from './chat-parts-from.ts';
import { listChatMessages } from './list-chat-messages.ts';
import { updateChatAnswer } from './update-chat-answer.ts';
import { test } from './testing/test.ts';

function seed(db: DatabaseSync): void {
  appendChatMessage(db, {
    ...base(),
    id: questionId(),
    role: 'user',
    parts: chatPartsFrom('Why?'),
  });
  appendChatMessage(db, {
    ...base(),
    id: answerId(),
    role: 'assistant',
    kind: 'answer',
    status: 'submitted',
    parts: [],
  });
}

function answer(db: DatabaseSync): ChatMessage | undefined {
  const listed = listChatMessages(db, sessionId());
  return listed.ok ? listed.value[1] : undefined;
}

describe('updateChatAnswer', () => {
  test('streams parts, then stores the final answer with its citations', ({ expect, db }) => {
    seed(db);
    const reading = {
      kind: 'tool-call',
      id: 'p1',
      tool: 'Read',
      description: 'read src/a.ts',
      state: 'running',
    } as const;
    expect(
      updateChatAnswer(db, answerId(), {
        status: 'streaming',
        parts: [reading, { kind: 'text', id: 'p2', text: 'Because' }],
      }),
    ).toStrictEqual({ ok: true, value: undefined });
    expect(answer(db)).toMatchObject({
      status: 'streaming',
      parts: [reading, { kind: 'text', id: 'p2', text: 'Because' }],
      citations: [],
    });
    const citations = [{ path: 'src/a.ts', startLine: 1, endLine: 2, side: 'head' as const }];
    const parts = [
      { ...reading, state: 'done' },
      { kind: 'text', id: 'p2', text: 'Because [[src/a.ts:1-2]].' },
    ] as const;
    updateChatAnswer(db, answerId(), { status: 'done', parts, citations });
    expect(answer(db)).toStrictEqual({
      ...base(),
      id: answerId(),
      role: 'assistant',
      kind: 'answer',
      status: 'done',
      parts,
      citations,
    });
  });

  test('records a failure as an error part, and replaces it again', ({ expect, db }) => {
    seed(db);
    updateChatAnswer(db, answerId(), {
      status: 'error',
      parts: [{ kind: 'error', id: 'p1', code: 'rate-limited' }],
    });
    expect(answer(db)).toMatchObject({
      status: 'error',
      parts: [{ kind: 'error', code: 'rate-limited' }],
    });
    updateChatAnswer(db, answerId(), { status: 'cancelled', parts: chatPartsFrom('Part') });
    expect(answer(db)).toMatchObject({ status: 'cancelled', parts: chatPartsFrom('Part') });
  });

  test('updates only existing assistant messages', ({ expect, db }) => {
    seed(db);
    expect(
      updateChatAnswer(db, questionId(), { status: 'done', parts: chatPartsFrom('x') }),
    ).toStrictEqual({
      ok: false,
      error: { kind: 'message-not-found', id: questionId() },
    });
    const missing = '00000000-0000-4000-8000-000000000009' as ChatMessageId;
    expect(
      updateChatAnswer(db, missing, { status: 'done', parts: chatPartsFrom('x') }),
    ).toMatchObject({
      ok: false,
    });
  });
});

function sessionId(): SessionId {
  return '11111111-1111-4111-8111-111111111111' as SessionId;
}

function base(): {
  sessionId: SessionId;
  headSha: CommitSha;
  citations: [];
  createdAt: string;
} {
  return {
    sessionId: sessionId(),
    headSha: 'c'.repeat(40) as CommitSha,
    citations: [],
    createdAt: '2026-10-28T12:00:00.000Z',
  };
}

function questionId(): ChatMessageId {
  return '00000000-0000-4000-8000-000000000001' as ChatMessageId;
}

function answerId(): ChatMessageId {
  return '00000000-0000-4000-8000-000000000002' as ChatMessageId;
}
