import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';

import type { Migration } from '#sqlite/run-migrations.ts';

/**
 * The chat domain's schema (ADR 0006, 0031). `chat_messages` references `sessions`, so main must
 * run the session domain's migrations first. `citations` is a JSON array of
 * `{ path, startLine, endLine, side }`; only assistant messages have a status other than
 * `complete`, and only a `failed` one has an error code. The `summary` role is ADR 0047's; `mentions` is a JSON array of
 * `{ path, side, startLine?, endLine?, sha }` that only questions carry (ADR 0046). An answer's
 * `kind` says which command it answers, and a completed `/review` keeps its findings in `review`
 * (ADR 0055); `queued` answers wait behind their session's running request (ADR 0057).
 * `chat-0002-message-parts` (ADR 0072) replaces `content`, `mentions` and `error_code` with
 * `parts`, a JSON array of typed parts, and renames the statuses to a request's: `queued`,
 * `submitted`, `streaming`, `done`, `error`, `cancelled`.
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
  { id: 'chat-0002-message-parts', up: migrateToParts },
];

/**
 * Rebuilds `chat_messages` with `parts` (SQLite can't drop columns its checks name). A question
 * becomes text and mention parts split at its `[[@n]]` tokens, a notice or summary one text part,
 * a `/review` answer one finding part per stored finding, any other answer one text part, and a
 * failed one ends with an error part holding its code. Self-contained: it must not change when
 * the domain's own helpers do.
 */
function migrateToParts(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE chat_messages_next (
      id TEXT PRIMARY KEY CHECK (length(id) = 36),
      session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
      head_sha TEXT NOT NULL
        CHECK (length(head_sha) IN (40, 64) AND head_sha NOT GLOB '*[^0-9a-f]*'),
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system-notice', 'summary')),
      parts TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(parts) AND json_type(parts) = 'array'),
      citations TEXT NOT NULL DEFAULT '[]'
        CHECK (json_valid(citations) AND json_type(citations) = 'array'),
      status TEXT NOT NULL DEFAULT 'done' CHECK (
        status IN ('queued', 'submitted', 'streaming', 'done', 'error', 'cancelled')
      ),
      kind TEXT NOT NULL DEFAULT 'answer' CHECK (kind IN ('answer', 'review', 'abstract')),
      review TEXT CHECK (review IS NULL OR (json_valid(review) AND json_type(review) = 'object')),
      created_at TEXT NOT NULL CHECK (created_at GLOB '${timestampPattern()}'),
      CHECK (role = 'assistant' OR status = 'done'),
      CHECK (role NOT IN ('user', 'summary') OR json_array_length(parts) > 0),
      CHECK (role = 'assistant' OR kind = 'answer'),
      CHECK (review IS NULL OR (kind = 'review' AND status = 'done'))
    ) STRICT;
  `);
  const insert = db.prepare(
    `INSERT INTO chat_messages_next (id, session_id, head_sha, role, parts, citations, status, kind,
                                     review, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), ?);`,
  );
  for (const row of db.prepare('SELECT * FROM chat_messages ORDER BY rowid;').all()) {
    const status = String(row['status']);
    insert.run(
      String(row['id']),
      String(row['session_id']),
      String(row['head_sha']),
      String(row['role']),
      JSON.stringify(partsOfRow(row)),
      String(row['citations']),
      renamedStatuses[status] ?? status,
      String(row['kind']),
      textOrEmpty(row['review']),
      String(row['created_at']),
    );
  }
  db.exec(`
    DROP TABLE chat_messages;
    ALTER TABLE chat_messages_next RENAME TO chat_messages;
    CREATE INDEX chat_messages_by_session ON chat_messages (session_id, created_at);
  `);
}

function partsOfRow(row: Record<string, SQLOutputValue>): object[] {
  const parts: object[] = [];
  const add = (part: object): void => {
    parts.push({ ...part, id: `p${String(parts.length + 1)}` });
  };
  const content = String(row['content']);
  let review: unknown;
  if (typeof row['review'] === 'string') {
    review = jsonOf(row['review']);
  }
  if (row['role'] === 'user') {
    const listed = listOf(jsonOf(String(row['mentions'])));
    const named = new Set<number>();
    let text = '';
    for (const piece of content.split(mentionTokenSplit)) {
      const index = mentionTokenPattern.exec(piece)?.[1];
      if (index === undefined) {
        text += piece;
        continue;
      }
      const mention = listed[Number(index) - 1];
      if (mention === undefined) {
        text += piece;
        continue;
      }
      if (text !== '') {
        add({ kind: 'text', text });
        text = '';
      }
      named.add(Number(index) - 1);
      add({ kind: 'mention', mention });
    }
    if (text !== '') {
      add({ kind: 'text', text });
    }
    for (const [index, mention] of listed.entries()) {
      if (!named.has(index)) {
        add({ kind: 'mention', mention });
      }
    }
    return parts;
  }
  const findings = (review as { findings?: unknown } | undefined)?.findings;
  if (row['kind'] === 'review' && Array.isArray(findings)) {
    for (const finding of findings.keys()) {
      add({ kind: 'finding', finding });
    }
  } else if (content !== '') {
    add({ kind: 'text', text: content });
  }
  if (row['status'] === 'failed') {
    add({ kind: 'error', code: String(row['error_code']) });
  }
  return parts;
}

const mentionTokenSplit = /(\[\[@[1-9]\d{0,2}\]\])/u;
const mentionTokenPattern = /^\[\[@([1-9]\d{0,2})\]\]$/u;

function jsonOf(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function timestampPattern(): string {
  return `${digits(4)}-${digits(2)}-${digits(2)}T${digits(2)}:${digits(2)}:${digits(2)}.${digits(3)}Z`;
}

function digits(count: number): string {
  return '[0-9]'.repeat(count);
}

/** chat-0002 renamed two statuses; the rest stay. */
const renamedStatuses: Readonly<Partial<Record<string, string>>> = {
  complete: 'done',
  failed: 'error',
};

function textOrEmpty(value: SQLOutputValue | undefined): string {
  if (typeof value === 'string') {
    return value;
  }
  return '';
}

function listOf(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) {
    return value as unknown[];
  }
  return [];
}
