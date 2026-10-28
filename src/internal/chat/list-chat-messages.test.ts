import { describe, expect, it } from 'vitest';

import type { SessionId } from './chat-message.ts';
import { listChatMessages } from './list-chat-messages.ts';
import { createChatTestDatabase } from './testing/create-chat-test-database.ts';

const sessionId = '11111111-1111-4111-8111-111111111111' as SessionId;

describe('listChatMessages', () => {
  it('orders by time, then insertion', () => {
    const db = createChatTestDatabase([sessionId]);
    const insert = db.prepare(
      `INSERT INTO chat_messages (id, session_id, head_sha, role, content, created_at)
       VALUES (?, ?, ?, 'user', ?, ?);`,
    );
    const head = 'c'.repeat(40);
    insert.run(
      '00000000-0000-4000-8000-000000000003',
      sessionId,
      head,
      'later',
      '2026-10-28T12:00:01.000Z',
    );
    insert.run(
      '00000000-0000-4000-8000-000000000002',
      sessionId,
      head,
      'first',
      '2026-10-28T12:00:00.000Z',
    );
    insert.run(
      '00000000-0000-4000-8000-000000000001',
      sessionId,
      head,
      'second',
      '2026-10-28T12:00:00.000Z',
    );
    const listed = listChatMessages(db, sessionId);
    expect(listed.ok && listed.value.map((message) => message.content)).toEqual([
      'first',
      'second',
      'later',
    ]);
  });

  it('reports a row whose citations are not citations', () => {
    const db = createChatTestDatabase([sessionId]);
    const id = '00000000-0000-4000-8000-000000000001';
    db.prepare(
      `INSERT INTO chat_messages (id, session_id, head_sha, role, content, citations, created_at)
       VALUES (?, ?, ?, 'assistant', 'a', '[{"path":"a.ts","startLine":0}]', ?);`,
    ).run(id, sessionId, 'c'.repeat(40), '2026-10-28T12:00:00.000Z');
    expect(listChatMessages(db, sessionId)).toEqual({
      ok: false,
      error: {
        kind: 'corrupt-row',
        table: 'chat_messages',
        id,
        reason: 'citations is not a JSON array of citations',
      },
    });
  });
});
