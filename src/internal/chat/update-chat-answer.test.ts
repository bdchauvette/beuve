import type { DatabaseSync } from 'node:sqlite';

import { describe } from 'vitest';

import { appendChatMessage } from './append-chat-message.ts';
import type { ChatMessage, ChatMessageId, CommitSha, SessionId } from './chat-message.ts';
import { listChatMessages } from './list-chat-messages.ts';
import { updateChatAnswer } from './update-chat-answer.ts';
import { test } from './testing/test.ts';

function seed(db: DatabaseSync): void {
  appendChatMessage(db, { ...base(), id: questionId(), role: 'user', content: 'Why?' });
  appendChatMessage(db, {
    ...base(),
    id: answerId(),
    role: 'assistant',
    kind: 'answer',
    status: 'streaming',
    content: '',
  });
}

function answer(db: DatabaseSync): ChatMessage | undefined {
  const listed = listChatMessages(db, sessionId());
  return listed.ok ? listed.value[1] : undefined;
}

describe('updateChatAnswer', () => {
  test('streams partial text, then stores the final answer with its citations', ({
    expect,
    db,
  }) => {
    seed(db);
    expect(
      updateChatAnswer(db, answerId(), { status: 'streaming', content: 'Because' }),
    ).toStrictEqual({
      ok: true,
      value: undefined,
    });
    expect(answer(db)).toMatchObject({ status: 'streaming', content: 'Because', citations: [] });
    const citations = [{ path: 'src/a.ts', startLine: 1, endLine: 2, side: 'head' as const }];
    updateChatAnswer(db, answerId(), {
      status: 'complete',
      content: 'Because [[src/a.ts:1-2]].',
      citations,
    });
    expect(answer(db)).toStrictEqual({
      ...base(),
      id: answerId(),
      role: 'assistant',
      kind: 'answer',
      status: 'complete',
      content: 'Because [[src/a.ts:1-2]].',
      citations,
    });
  });

  test('records a failure code and clears it again', ({ expect, db }) => {
    seed(db);
    updateChatAnswer(db, answerId(), { status: 'failed', errorCode: 'rate-limited', content: '' });
    expect(answer(db)).toMatchObject({ status: 'failed', errorCode: 'rate-limited' });
    updateChatAnswer(db, answerId(), { status: 'cancelled', content: 'Part' });
    expect(answer(db)).not.toHaveProperty('errorCode');
  });

  test('updates only existing assistant messages', ({ expect, db }) => {
    seed(db);
    expect(updateChatAnswer(db, questionId(), { status: 'complete', content: 'x' })).toStrictEqual({
      ok: false,
      error: { kind: 'message-not-found', id: questionId() },
    });
    const missing = '00000000-0000-4000-8000-000000000009' as ChatMessageId;
    expect(updateChatAnswer(db, missing, { status: 'complete', content: 'x' })).toMatchObject({
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
  mentions: [];
  createdAt: string;
} {
  return {
    sessionId: sessionId(),
    headSha: 'c'.repeat(40) as CommitSha,
    citations: [],
    mentions: [],
    createdAt: '2026-10-28T12:00:00.000Z',
  };
}

function questionId(): ChatMessageId {
  return '00000000-0000-4000-8000-000000000001' as ChatMessageId;
}

function answerId(): ChatMessageId {
  return '00000000-0000-4000-8000-000000000002' as ChatMessageId;
}
