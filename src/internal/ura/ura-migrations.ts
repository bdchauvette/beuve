import type { Migration } from '#sqlite/run-migrations.ts';

import { uraSeverities } from './ura-severities.ts';

/**
 * The URA domain's schema (ADR 0006, 0023, 0039, 0045, 0055, 0102, 0131, 0132, 0134). Append-only:
 * a schema change is a new migration, never an edit (ADR 0006 amendment 2026-11-11). The `severity`
 * CHECK is built from `uraSeverities`, so changing the labels needs a migration that rebuilds the
 * table.
 * `ura_items` references `sessions`, so main runs the session domain's migrations first. Table
 * CHECKs mirror the anchor, origin and status unions. `chat_message_id` deliberately has no foreign
 * key: the chat domain owns that table, and `/clear` must not delete staged items.
 * `chat_proposal` is the index of a note an answer proposed (ADR 0132), staged at most once per
 * answer like a finding.
 */
export const uraMigrations: readonly Migration[] = [
  {
    id: 'ura-0001-initial',
    up: `
      CREATE TABLE ura_items (
        id TEXT PRIMARY KEY CHECK (length(id) = 36),
        session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK (position >= 0),
        head_sha TEXT NOT NULL CHECK (${sha('head_sha')}),
        anchor_kind TEXT NOT NULL CHECK (anchor_kind IN ('lines', 'file', 'change')),
        path TEXT,
        line_start INTEGER,
        line_end INTEGER,
        severity TEXT NOT NULL CHECK (severity IN (${list(uraSeverities)})),
        blocking INTEGER NOT NULL CHECK (blocking IN (0, 1)),
        origin_kind TEXT NOT NULL
          CHECK (origin_kind IN ('human', 'chat-answer')),
        chat_message_id TEXT,
        chat_finding INTEGER CHECK (chat_finding IS NULL OR chat_finding >= 0),
        chat_proposal INTEGER CHECK (chat_proposal IS NULL OR chat_proposal >= 0),
        title TEXT NOT NULL CHECK (title = trim(title) AND length(title) <= 200),
        body TEXT NOT NULL,
        patch TEXT CHECK (patch IS NULL OR (patch <> '' AND anchor_kind <> 'change')),
        status TEXT NOT NULL CHECK (status IN ('staged', 'withdrawn', 'addressed')),
        addressed_sha TEXT CHECK (addressed_sha IS NULL OR ${sha('addressed_sha')}),
        addressed_by TEXT CHECK (addressed_by IS NULL OR addressed_by IN ('reviewer', 'agent')),
        created_at TEXT NOT NULL CHECK (${timestamp('created_at')}),
        updated_at TEXT NOT NULL CHECK (${timestamp('updated_at')}),
        -- A note says something: a title is optional, but not all of title, body and patch.
        CHECK (title <> '' OR trim(body) <> '' OR patch IS NOT NULL),
        -- Every branch tests IS NOT NULL first: a NULL comparison would make a CHECK pass.
        CHECK (
          (anchor_kind = 'lines' AND path IS NOT NULL AND path <> ''
            AND line_start IS NOT NULL AND line_end IS NOT NULL
            AND line_start >= 1 AND line_end >= line_start)
          OR (anchor_kind = 'file' AND path IS NOT NULL AND path <> ''
            AND line_start IS NULL AND line_end IS NULL)
          OR (anchor_kind = 'change' AND path IS NULL AND line_start IS NULL AND line_end IS NULL)
        ),
        CHECK (
          (origin_kind = 'human' AND chat_message_id IS NULL AND chat_finding IS NULL
            AND chat_proposal IS NULL)
          OR (origin_kind = 'chat-answer' AND chat_message_id IS NOT NULL
            AND trim(chat_message_id) <> ''
            AND (chat_finding IS NULL) <> (chat_proposal IS NULL)
            AND anchor_kind = 'lines')
        ),
        CHECK (
          (status = 'addressed') = (addressed_sha IS NOT NULL)
          AND (status = 'addressed') = (addressed_by IS NOT NULL)
          AND (addressed_sha IS NULL OR addressed_sha <> head_sha)
        )
      ) STRICT;

      CREATE INDEX ura_items_by_session ON ura_items (session_id, position);
      CREATE UNIQUE INDEX ura_items_by_chat_finding ON ura_items (chat_message_id, chat_finding)
        WHERE chat_finding IS NOT NULL;
      CREATE UNIQUE INDEX ura_items_by_chat_proposal ON ura_items (chat_message_id, chat_proposal)
        WHERE chat_proposal IS NOT NULL;

      CREATE TABLE ura_verdict_choices (
        session_id TEXT PRIMARY KEY REFERENCES sessions (id) ON DELETE CASCADE,
        verdict TEXT CHECK (verdict IS NULL OR verdict IN ('approve', 'request-changes', 'comment')),
        cleared_reason TEXT
          CHECK (cleared_reason IS NULL OR cleared_reason IN ('blocking-staged', 'head-moved')),
        head_sha TEXT CHECK (head_sha IS NULL OR (${sha('head_sha')})),
        updated_at TEXT NOT NULL CHECK (${timestamp('updated_at')}),
        CHECK (verdict IS NULL OR cleared_reason IS NULL),
        CHECK ((verdict IS NULL) = (head_sha IS NULL))
      ) STRICT;

      -- ADR 0039: which staged items a posted GitHub review carried, so posting again sends only
      -- what is new. The item stays staged; the posting is a fact about it, not a status.
      CREATE TABLE ura_item_postings (
        item_id TEXT NOT NULL REFERENCES ura_items (id) ON DELETE CASCADE,
        target TEXT NOT NULL CHECK (target IN ('github')),
        session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
        url TEXT NOT NULL CHECK (url GLOB 'http*://*'),
        head_sha TEXT NOT NULL CHECK (${sha('head_sha')}),
        placement TEXT NOT NULL CHECK (placement IN ('inline', 'body')),
        posted_at TEXT NOT NULL CHECK (${timestamp('posted_at')}),
        PRIMARY KEY (item_id, target)
      ) STRICT;

      CREATE INDEX ura_item_postings_by_session ON ura_item_postings (session_id, posted_at);
    `,
  },
];

function list(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

function sha(column: string): string {
  return `length(${column}) IN (40, 64) AND ${column} NOT GLOB '*[^0-9a-f]*'`;
}

function timestamp(column: string): string {
  return `${column} GLOB '${digits(4)}-${digits(2)}-${digits(2)}T${digits(2)}:${digits(2)}:${digits(2)}.${digits(3)}Z'`;
}

function digits(count: number): string {
  return '[0-9]'.repeat(count);
}
