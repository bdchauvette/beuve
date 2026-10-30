import type { Migration } from '#x/sqlite/run-migrations.ts';

import { uraSeverities } from './ura-severities.ts';

const originColumns = [
  'chat_message_id',
  'chat_finding',
  'impact_metric',
  'impact_function',
  'impact_value',
  'impact_threshold',
  'impact_percentile',
] as const;

/**
 * The URA domain's schema (ADR 0006, 0023, 0039, 0045, 0055; squashed until the first release).
 * `ura_items` references `sessions`, so main runs the session domain's migrations first. Table
 * CHECKs mirror the anchor, origin and status unions. `chat_message_id` deliberately has no foreign
 * key: the chat domain owns that table, and `/clear` must not delete staged items.
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
        origin_kind TEXT NOT NULL
          CHECK (origin_kind IN ('human', 'impact-finding', 'chat-answer')),
        chat_message_id TEXT,
        chat_finding INTEGER CHECK (chat_finding IS NULL OR chat_finding >= 0),
        impact_metric TEXT,
        impact_function TEXT,
        impact_value REAL,
        impact_threshold REAL,
        impact_percentile REAL,
        title TEXT NOT NULL CHECK (trim(title) <> '' AND length(title) <= 200),
        body TEXT NOT NULL,
        patch TEXT CHECK (patch IS NULL OR (patch <> '' AND anchor_kind <> 'change')),
        status TEXT NOT NULL CHECK (status IN ('staged', 'withdrawn', 'addressed')),
        addressed_sha TEXT CHECK (addressed_sha IS NULL OR ${sha('addressed_sha')}),
        addressed_by TEXT CHECK (addressed_by IS NULL OR addressed_by IN ('reviewer', 'agent')),
        created_at TEXT NOT NULL CHECK (${timestamp('created_at')}),
        updated_at TEXT NOT NULL CHECK (${timestamp('updated_at')}),
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
          (origin_kind = 'human' AND ${allNull(originColumns)})
          OR (origin_kind = 'chat-answer' AND chat_message_id IS NOT NULL
            AND trim(chat_message_id) <> ''
            AND (chat_finding IS NULL OR anchor_kind = 'lines')
            AND ${allNull(originColumns.filter((column) => !column.startsWith('chat_')))})
          OR (origin_kind = 'impact-finding' AND anchor_kind = 'lines'
            AND impact_metric IS NOT NULL AND impact_metric IN ('cognitive-complexity')
            AND impact_function IS NOT NULL AND trim(impact_function) <> ''
            AND impact_value IS NOT NULL AND impact_threshold IS NOT NULL
            AND impact_percentile IS NOT NULL AND impact_percentile BETWEEN 0 AND 100
            AND chat_message_id IS NULL AND chat_finding IS NULL)
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
      CREATE UNIQUE INDEX ura_items_by_finding
        ON ura_items (session_id, head_sha, path, impact_metric, impact_function)
        WHERE origin_kind = 'impact-finding';

      CREATE TABLE ura_verdict_choices (
        session_id TEXT PRIMARY KEY REFERENCES sessions (id) ON DELETE CASCADE,
        verdict TEXT CHECK (verdict IS NULL OR verdict IN ('approve', 'request-changes', 'comment')),
        cleared_reason TEXT
          CHECK (cleared_reason IS NULL OR cleared_reason IN ('blocker-staged', 'head-moved')),
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

function allNull(columns: readonly string[]): string {
  return columns.map((column) => `${column} IS NULL`).join(' AND ');
}

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
