import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { describe } from 'vitest';

import { openDatabase } from '#sqlite/open-database.ts';
import { runMigrations } from '#sqlite/run-migrations.ts';
import type { Migration } from '#sqlite/run-migrations.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import type { SessionId } from './chat-message.ts';
import { chatMigrations } from './chat-migrations.ts';
import { listChatMessages } from './list-chat-messages.ts';
import { test } from './testing/test.ts';

function insert(db: DatabaseSync, fields: Record<string, string>): () => void {
  const row = {
    id: randomUUID(),
    session_id: sessionId(),
    head_sha: head(),
    role: 'assistant',
    parts: '[{"kind":"text","id":"p1","text":"answer"}]',
    citations: '[]',
    status: 'done',
    kind: 'answer',
    review: '',
    created_at: at(),
    ...fields,
  };
  return (): void => {
    db.prepare(
      `INSERT INTO chat_messages (id, session_id, head_sha, role, parts, citations, status, kind,
                                  review, created_at)
       VALUES (:id, :session_id, :head_sha, :role, :parts, :citations, :status, :kind,
               NULLIF(:review, ''), :created_at);`,
    ).run(row);
  };
}

describe('chatMigrations', () => {
  test('accepts a well-formed row', ({ expect, db }) => {
    expect(insert(db, {})).not.toThrow();
    expect(insert(db, { status: 'error', parts: '[{"kind":"error","id":"p1"}]' })).not.toThrow();
    expect(insert(db, { role: 'summary' })).not.toThrow();
    expect(insert(db, { role: 'user', parts: '[{"kind":"mention","id":"p1"}]' })).not.toThrow();
    expect(insert(db, { status: 'queued', parts: '[]' })).not.toThrow();
    expect(insert(db, { status: 'submitted', parts: '[]' })).not.toThrow();
    expect(insert(db, { kind: 'review', review: '{"findings":[]}' })).not.toThrow();
    expect(insert(db, { kind: 'abstract', status: 'streaming' })).not.toThrow();
  });

  test.for<[string, Record<string, string>]>([
    ['an unknown role', { role: 'tool' }],
    ['an unknown status', { status: 'complete' }],
    ['a streaming user message', { role: 'user', status: 'streaming' }],
    ['a submitted notice', { role: 'system-notice', status: 'submitted' }],
    ['a question without parts', { role: 'user', parts: '[]' }],
    ['parts that are not an array', { parts: '{}' }],
    ['citations that are not an array', { citations: '{}' }],
    ['a short head', { head_sha: 'abc' }],
    ['a local timestamp', { created_at: '2026-10-28 12:00' }],
    ['an unknown session', { session_id: '22222222-2222-4222-8222-222222222222' }],
    ['an empty summary', { role: 'summary', parts: '[]' }],
    ['a streaming summary', { role: 'summary', status: 'streaming' }],
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
      `INSERT INTO chat_messages (id, session_id, head_sha, role, parts, created_at)
       VALUES ('00000000-0000-4000-8000-000000000001', ?, ?, 'user', '[{"kind":"text"}]', ?);`,
    ).run(sessionId(), head(), at());
    db.prepare('DELETE FROM sessions WHERE id = ?;').run(sessionId());
    expect(db.prepare('SELECT count(*) AS n FROM chat_messages;').get()?.['n']).toBe(0);
  });
});

describe('chat-0002-message-parts', () => {
  test('moves stored messages into parts and renames the statuses', ({ expect, closing }) => {
    const db = closing(openDatabase(':memory:'));
    const [initial] = chatMigrations;
    runMigrations(db, [sessionsStub(), ...(initial === undefined ? [] : [initial])]);
    db.prepare('INSERT INTO sessions (id) VALUES (?);').run(sessionId());
    const old = db.prepare(
      `INSERT INTO chat_messages (id, session_id, head_sha, role, content, mentions, status,
                                  error_code, kind, review, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), ?, NULLIF(?, ''), ?);`,
    );
    const mention = { path: 'a.ts', side: 'head', startLine: 2, endLine: 3, sha: head() };
    const finding = {
      path: 'a.ts',
      startLine: 2,
      endLine: 2,
      severity: 'risk',
      category: 'edge-case',
      title: 'Empty input',
      body: 'It throws.',
      confidence: 0.8,
      check: 'confirmed',
    };
    const review = JSON.stringify({
      findings: [finding, finding],
      dropped: {
        unknownFile: 0,
        outsideDiff: 0,
        lowConfidence: 0,
        duplicate: 0,
        overLimit: 0,
        unconfirmed: 0,
      },
      pathScope: [],
      fileCount: 1,
      verification: 'verified',
    });
    const rows: [string, string, string, string, string, string, string, string][] = [
      [
        'user',
        'Why [[@1]] and [[@3]]?',
        JSON.stringify([mention]),
        'complete',
        '',
        'answer',
        '',
        '',
      ],
      ['assistant', 'Because [[a.ts:2-3]].', '[]', 'complete', '', 'answer', '', ''],
      ['assistant', 'Half', '[]', 'failed', 'timeout', 'answer', '', ''],
      ['assistant', '**Review**', '[]', 'complete', '', 'review', review, ''],
      ['assistant', '', '[]', 'queued', '', 'abstract', '', ''],
      ['summary', '**Asked**', '[]', 'complete', '', 'answer', '', ''],
    ];
    for (const [index, [role, content, mentions, status, code, kind, stored]] of rows.entries()) {
      old.run(
        `00000000-0000-4000-8000-00000000000${String(index)}`,
        sessionId(),
        head(),
        role,
        content,
        mentions,
        status,
        code,
        kind,
        stored,
        at(),
      );
    }
    expect(runMigrations(db, [sessionsStub(), ...chatMigrations])).toStrictEqual([
      'chat-0002-message-parts',
    ]);
    const listed = okValueFrom(listChatMessages(db, sessionId() as SessionId));
    expect(
      listed.map((message) => ({
        role: message.role,
        status: 'status' in message ? message.status : undefined,
        parts: message.parts,
      })),
    ).toStrictEqual([
      {
        role: 'user',
        status: undefined,
        parts: [
          { kind: 'text', id: 'p1', text: 'Why ' },
          { kind: 'mention', id: 'p2', mention },
          { kind: 'text', id: 'p3', text: ' and [[@3]]?' },
        ],
      },
      {
        role: 'assistant',
        status: 'done',
        parts: [{ kind: 'text', id: 'p1', text: 'Because [[a.ts:2-3]].' }],
      },
      {
        role: 'assistant',
        status: 'error',
        parts: [
          { kind: 'text', id: 'p1', text: 'Half' },
          { kind: 'error', id: 'p2', code: 'timeout' },
        ],
      },
      {
        role: 'assistant',
        status: 'done',
        parts: [
          { kind: 'finding', id: 'p1', finding: 0 },
          { kind: 'finding', id: 'p2', finding: 1 },
        ],
      },
      { role: 'assistant', status: 'queued', parts: [] },
      {
        role: 'summary',
        status: undefined,
        parts: [{ kind: 'text', id: 'p1', text: '**Asked**' }],
      },
    ]);
  });
});

function sessionsStub(): Migration {
  return {
    id: 'test-0000-sessions-stub',
    up: 'CREATE TABLE sessions (id TEXT PRIMARY KEY) STRICT;',
  };
}

function sessionId(): string {
  return '11111111-1111-4111-8111-111111111111';
}

function head(): string {
  return 'c'.repeat(40);
}

function at(): string {
  return '2026-10-28T12:00:00.000Z';
}
