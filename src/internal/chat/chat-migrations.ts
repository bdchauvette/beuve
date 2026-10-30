import type { Migration } from '#sqlite/run-migrations.ts';

/**
 * The chat domain's schema (ADR 0006, 0031). `chat_messages` references `sessions`, so main must
 * run the session domain's migrations first. `citations` is a JSON array of
 * `{ path, startLine, endLine, side }`; only assistant messages have a status other than
 * `complete`, and only a `failed` one has an error code. The `summary` role is ADR 0047's; `mentions` is a JSON array of
 * `{ path, side, startLine?, endLine?, sha }` that only questions carry (ADR 0046). An answer's
 * `kind` says which command it answers, and a completed `/review` keeps its findings in `review`
 * (ADR 0055); `queued` answers wait behind their session's running request (ADR 0057). Squashed
 * until the first release.
 */
export const chatMigrations: readonly Migration[] = [
  {
    id: 'chat-0001-initial',
    up: `
      CREATE TABLE chat_messages (
        id TEXT PRIMARY KEY CHECK (length(id) = 36),
        session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
        head_sha TEXT NOT NULL
          CHECK (length(head_sha) IN (40, 64) AND head_sha NOT GLOB '*[^0-9a-f]*'),
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system-notice', 'summary')),
        content TEXT NOT NULL,
        citations TEXT NOT NULL DEFAULT '[]'
          CHECK (json_valid(citations) AND json_type(citations) = 'array'),
        mentions TEXT NOT NULL DEFAULT '[]'
          CHECK (json_valid(mentions) AND json_type(mentions) = 'array'),
        status TEXT NOT NULL DEFAULT 'complete'
          CHECK (status IN ('queued', 'streaming', 'complete', 'failed', 'cancelled')),
        kind TEXT NOT NULL DEFAULT 'answer' CHECK (kind IN ('answer', 'review', 'abstract')),
        review TEXT CHECK (review IS NULL OR (json_valid(review) AND json_type(review) = 'object')),
        error_code TEXT CHECK (error_code IS NULL OR trim(error_code) <> ''),
        created_at TEXT NOT NULL CHECK (created_at GLOB '${timestampPattern()}'),
        CHECK (role = 'assistant' OR status = 'complete'),
        CHECK ((status = 'failed') = (error_code IS NOT NULL)),
        CHECK (role NOT IN ('user', 'summary') OR trim(content) <> ''),
        CHECK (role = 'user' OR json_array_length(mentions) = 0),
        CHECK (role = 'assistant' OR kind = 'answer'),
        CHECK (review IS NULL OR (kind = 'review' AND status = 'complete'))
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
