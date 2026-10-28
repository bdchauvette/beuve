import type { Migration } from '#pkg/sqlite/run-migrations.ts';

/**
 * The chat domain's schema (ADR 0006, 0031). `chat_messages` references `sessions`, so main must
 * run the session domain's migrations first. `citations` is a JSON array of
 * `{ path, startLine, endLine, side }`; only assistant messages have a status other than
 * `complete`, and only a `failed` one has an error code.
 */
export const chatMigrations: readonly Migration[] = [
  {
    id: 'chat-0001-messages',
    up: `
      CREATE TABLE chat_messages (
        id TEXT PRIMARY KEY CHECK (length(id) = 36),
        session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
        head_sha TEXT NOT NULL
          CHECK (length(head_sha) IN (40, 64) AND head_sha NOT GLOB '*[^0-9a-f]*'),
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system-notice')),
        content TEXT NOT NULL,
        citations TEXT NOT NULL DEFAULT '[]'
          CHECK (json_valid(citations) AND json_type(citations) = 'array'),
        status TEXT NOT NULL DEFAULT 'complete'
          CHECK (status IN ('streaming', 'complete', 'failed', 'cancelled')),
        error_code TEXT CHECK (error_code IS NULL OR trim(error_code) <> ''),
        created_at TEXT NOT NULL CHECK (created_at GLOB '${timestampPattern()}'),
        CHECK (role = 'assistant' OR status = 'complete'),
        CHECK ((status = 'failed') = (error_code IS NOT NULL)),
        CHECK (role <> 'user' OR trim(content) <> '')
      ) STRICT;

      CREATE INDEX chat_messages_by_session ON chat_messages (session_id, created_at);
    `,
  },
];

function timestampPattern(): string {
  return `${digits(4)}-${digits(2)}-${digits(2)}T${digits(2)}:${digits(2)}:${digits(2)}.${digits(3)}Z`;
}

function digits(count: number): string {
  return '[0-9]'.repeat(count);
}
