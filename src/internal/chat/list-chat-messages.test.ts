import { describe } from 'vitest';

import type { SessionId } from './chat-message.ts';
import { chatTextFrom } from './chat-text-from.ts';
import { listChatMessages } from './list-chat-messages.ts';
import { test } from './testing/test.ts';

describe('listChatMessages', () => {
  test('orders by time, then insertion', ({ expect, db }) => {
    const insert = db.prepare(
      `INSERT INTO chat_messages (id, session_id, head_sha, role, parts, created_at)
       VALUES (?, ?, ?, 'user', json_array(json_object('kind', 'text', 'id', 'p1', 'text', ?)), ?);`,
    );
    const head = 'c'.repeat(40);
    insert.run(
      '00000000-0000-4000-8000-000000000003',
      sessionId(),
      head,
      'later',
      '2026-10-28T12:00:01.000Z',
    );
    insert.run(
      '00000000-0000-4000-8000-000000000002',
      sessionId(),
      head,
      'first',
      '2026-10-28T12:00:00.000Z',
    );
    insert.run(
      '00000000-0000-4000-8000-000000000001',
      sessionId(),
      head,
      'second',
      '2026-10-28T12:00:00.000Z',
    );
    const listed = listChatMessages(db, sessionId());
    expect(listed.ok && listed.value.map((message) => chatTextFrom(message.parts))).toStrictEqual([
      'first',
      'second',
      'later',
    ]);
  });

  test('reports a row whose citations are not citations', ({ expect, db }) => {
    const id = '00000000-0000-4000-8000-000000000001';
    db.prepare(
      `INSERT INTO chat_messages (id, session_id, head_sha, role, citations, created_at)
       VALUES (?, ?, ?, 'assistant', '[{"path":"a.ts","startLine":0}]', ?);`,
    ).run(id, sessionId(), 'c'.repeat(40), '2026-10-28T12:00:00.000Z');
    expect(listChatMessages(db, sessionId())).toStrictEqual({
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

function sessionId(): SessionId {
  return '11111111-1111-4111-8111-111111111111' as SessionId;
}
