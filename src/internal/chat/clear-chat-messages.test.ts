import { describe } from 'vitest';

import { appendChatMessage } from './append-chat-message.ts';
import type { ChatMessageId, CommitSha, SessionId } from './chat-message.ts';
import { chatPartsFrom } from './chat-parts-from.ts';
import { clearChatMessages } from './clear-chat-messages.ts';
import { listChatMessages } from './list-chat-messages.ts';
import { test } from './testing/test.ts';

describe('clearChatMessages', () => {
  test("deletes one session's transcript only", ({ expect, db }) => {
    db.prepare('INSERT INTO sessions (id) VALUES (?);').run(second());
    const message = {
      headSha: 'c'.repeat(40) as CommitSha,
      role: 'user' as const,
      parts: chatPartsFrom('Why?'),
      citations: [],
      createdAt: '2026-10-28T12:00:00.000Z',
    };
    appendChatMessage(db, {
      ...message,
      id: '00000000-0000-4000-8000-000000000001' as ChatMessageId,
      sessionId: first(),
    });
    appendChatMessage(db, {
      ...message,
      id: '00000000-0000-4000-8000-000000000002' as ChatMessageId,
      sessionId: first(),
    });
    appendChatMessage(db, {
      ...message,
      id: '00000000-0000-4000-8000-000000000003' as ChatMessageId,
      sessionId: second(),
    });
    expect(clearChatMessages(db, first())).toBe(2);
    expect(listChatMessages(db, first())).toStrictEqual({ ok: true, value: [] });
    expect(listChatMessages(db, second())).toMatchObject({
      ok: true,
      value: [{ sessionId: second() }],
    });
  });
});

function first(): SessionId {
  return '11111111-1111-4111-8111-111111111111' as SessionId;
}

function second(): SessionId {
  return '22222222-2222-4222-8222-222222222222' as SessionId;
}
