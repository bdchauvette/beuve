import { describe, expect, it } from 'vitest';

import { appendChatMessage } from './append-chat-message.ts';
import type { ChatMessage, ChatMessageId, CommitSha, SessionId } from './chat-message.ts';
import { listChatMessages } from './list-chat-messages.ts';
import { createChatTestDatabase } from './testing/create-chat-test-database.ts';
import { updateChatAnswer } from './update-chat-answer.ts';

const sessionId = '11111111-1111-4111-8111-111111111111' as SessionId;
const base = {
  sessionId,
  headSha: 'c'.repeat(40) as CommitSha,
  citations: [],
  createdAt: '2026-10-28T12:00:00.000Z',
};
const questionId = '00000000-0000-4000-8000-000000000001' as ChatMessageId;
const answerId = '00000000-0000-4000-8000-000000000002' as ChatMessageId;

function seeded(): ReturnType<typeof createChatTestDatabase> {
  const db = createChatTestDatabase([sessionId]);
  appendChatMessage(db, { ...base, id: questionId, role: 'user', content: 'Why?' });
  appendChatMessage(db, {
    ...base,
    id: answerId,
    role: 'assistant',
    status: 'streaming',
    content: '',
  });
  return db;
}

function answer(db: ReturnType<typeof createChatTestDatabase>): ChatMessage | undefined {
  const listed = listChatMessages(db, sessionId);
  return listed.ok ? listed.value[1] : undefined;
}

describe('updateChatAnswer', () => {
  it('streams partial text, then stores the final answer with its citations', () => {
    const db = seeded();
    expect(updateChatAnswer(db, answerId, { status: 'streaming', content: 'Because' })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(answer(db)).toMatchObject({ status: 'streaming', content: 'Because', citations: [] });
    const citations = [{ path: 'src/a.ts', startLine: 1, endLine: 2, side: 'head' as const }];
    updateChatAnswer(db, answerId, {
      status: 'complete',
      content: 'Because [[src/a.ts:1-2]].',
      citations,
    });
    expect(answer(db)).toEqual({
      ...base,
      id: answerId,
      role: 'assistant',
      status: 'complete',
      content: 'Because [[src/a.ts:1-2]].',
      citations,
    });
  });

  it('records a failure code and clears it again', () => {
    const db = seeded();
    updateChatAnswer(db, answerId, { status: 'failed', errorCode: 'rate-limited', content: '' });
    expect(answer(db)).toMatchObject({ status: 'failed', errorCode: 'rate-limited' });
    updateChatAnswer(db, answerId, { status: 'cancelled', content: 'Part' });
    expect(answer(db)).not.toHaveProperty('errorCode');
  });

  it('updates only existing assistant messages', () => {
    const db = seeded();
    expect(updateChatAnswer(db, questionId, { status: 'complete', content: 'x' })).toEqual({
      ok: false,
      error: { kind: 'message-not-found', id: questionId },
    });
    const missing = '00000000-0000-4000-8000-000000000009' as ChatMessageId;
    expect(updateChatAnswer(db, missing, { status: 'complete', content: 'x' })).toMatchObject({
      ok: false,
    });
  });
});
