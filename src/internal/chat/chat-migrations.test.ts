import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { describe } from 'vitest';

import { test } from './testing/test.ts';

function insert(db: DatabaseSync, fields: Record<string, string>): () => void {
  const row = {
    id: randomUUID(),
    session_id: sessionId(),
    head_sha: head(),
    role: 'assistant',
    content: 'answer',
    citations: '[]',
    mentions: '[]',
    status: 'complete',
    error_code: '',
    kind: 'answer',
    review: '',
    created_at: at(),
    ...fields,
  };
  return (): void => {
    db.prepare(
      `INSERT INTO chat_messages (id, session_id, head_sha, role, content, citations, mentions,
                                  status, error_code, kind, review, created_at)
       VALUES (:id, :session_id, :head_sha, :role, :content, :citations, :mentions, :status,
               NULLIF(:error_code, ''), :kind, NULLIF(:review, ''), :created_at);`,
    ).run(row);
  };
}

describe('chatMigrations', () => {
  test('accepts a well-formed row', ({ expect, db }) => {
    expect(insert(db, {})).not.toThrow();
    expect(insert(db, { status: 'failed', error_code: 'timeout' })).not.toThrow();
    expect(insert(db, { role: 'summary', content: '**Asked**' })).not.toThrow();
    expect(
      insert(db, { role: 'user', mentions: '[{"path":"a.ts","side":"head","sha":"x"}]' }),
    ).not.toThrow();
    expect(insert(db, { status: 'queued' })).not.toThrow();
    expect(insert(db, { kind: 'review', review: '{"findings":[]}' })).not.toThrow();
    expect(insert(db, { kind: 'abstract', status: 'streaming' })).not.toThrow();
  });

  test.for<[string, Record<string, string>]>([
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
    ['an empty summary', { role: 'summary', content: ' ' }],
    ['a streaming summary', { role: 'summary', status: 'streaming' }],
    ['mentions on an answer', { mentions: '[{"path":"a"}]' }],
    ['mentions that are not an array', { role: 'user', mentions: '{}' }],
    ['a queued question', { role: 'user', status: 'queued' }],
    ['an unknown kind', { kind: 'essay' }],
    ['a kind on a question', { role: 'user', kind: 'review' }],
    ['findings on a plain answer', { review: '{"findings":[]}' }],
    ['findings on a streaming review', { kind: 'review', status: 'streaming', review: '{}' }],
    ['findings that are not an object', { kind: 'review', review: '[]' }],
  ])('rejects %s', ([, fields], { expect, db }) => {
    expect(insert(db, fields)).toThrow(/constraint failed/u);
  });

  test('deletes a session’s messages with the session', ({ expect, db }) => {
    db.prepare(
      `INSERT INTO chat_messages (id, session_id, head_sha, role, content, created_at)
       VALUES ('00000000-0000-4000-8000-000000000001', ?, ?, 'user', 'q', ?);`,
    ).run(sessionId(), head(), at());
    db.prepare('DELETE FROM sessions WHERE id = ?;').run(sessionId());
    expect(db.prepare('SELECT count(*) AS n FROM chat_messages;').get()?.['n']).toBe(0);
  });
});

function sessionId(): string {
  return '11111111-1111-4111-8111-111111111111';
}

function head(): string {
  return 'c'.repeat(40);
}

function at(): string {
  return '2026-10-28T12:00:00.000Z';
}
