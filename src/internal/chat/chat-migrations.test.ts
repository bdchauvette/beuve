import { describe, expect, it } from 'vitest';

import { createChatTestDatabase } from './testing/create-chat-test-database.ts';

const sessionId = '11111111-1111-4111-8111-111111111111';
const head = 'c'.repeat(40);
const at = '2026-10-28T12:00:00.000Z';

function insert(fields: Record<string, string>): () => void {
  const db = createChatTestDatabase([sessionId]);
  const row = {
    id: '00000000-0000-4000-8000-000000000001',
    session_id: sessionId,
    head_sha: head,
    role: 'assistant',
    content: 'answer',
    citations: '[]',
    status: 'complete',
    error_code: '',
    created_at: at,
    ...fields,
  };
  return (): void => {
    db.prepare(
      `INSERT INTO chat_messages (id, session_id, head_sha, role, content, citations, status,
                                  error_code, created_at)
       VALUES (:id, :session_id, :head_sha, :role, :content, :citations, :status, NULLIF(:error_code, ''),
               :created_at);`,
    ).run(row);
  };
}

describe('chatMigrations', () => {
  it('accepts a well-formed row', () => {
    expect(insert({})).not.toThrow();
    expect(insert({ status: 'failed', error_code: 'timeout' })).not.toThrow();
  });

  it.each([
    ['an unknown role', { role: 'tool' }],
    ['an unknown status', { status: 'done' }],
    ['a streaming user message', { role: 'user', status: 'streaming' }],
    ['a failure without a code', { status: 'failed' }],
    ['a code without a failure', { error_code: 'timeout' }],
    ['an empty question', { role: 'user', content: '  ' }],
    ['citations that are not an array', { citations: '{}' }],
    ['a short head', { head_sha: 'abc' }],
    ['a local timestamp', { created_at: '2026-10-28 12:00' }],
    ['an unknown session', { session_id: '22222222-2222-4222-8222-222222222222' }],
  ])('rejects %s', (_, fields) => {
    expect(insert(fields)).toThrow();
  });

  it('deletes a session’s messages with the session', () => {
    const db = createChatTestDatabase([sessionId]);
    db.prepare(
      `INSERT INTO chat_messages (id, session_id, head_sha, role, content, created_at)
       VALUES ('00000000-0000-4000-8000-000000000001', ?, ?, 'user', 'q', ?);`,
    ).run(sessionId, head, at);
    db.prepare('DELETE FROM sessions WHERE id = ?;').run(sessionId);
    expect(db.prepare('SELECT count(*) AS n FROM chat_messages;').get()).toEqual({ n: 0 });
  });
});
