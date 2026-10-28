import type { Migration } from '#pkg/sqlite/run-migrations.ts';

import { uraSeverities } from './ura-severities.ts';

const originColumns = [
  'insight_id',
  'chat_message_id',
  'impact_metric',
  'impact_function',
  'impact_value',
  'impact_threshold',
  'impact_percentile',
] as const;

/**
 * The URA domain's schema (ADR 0006, 0023). `ura_items` references `sessions`, so main runs the
 * session domain's migrations first. Table CHECKs mirror the anchor, origin and status unions.
 * `insight_id` deliberately has no foreign key: a fresh review run replaces its insights, and a
 * promoted item must outlive the insight it came from.
 */
export const uraMigrations: readonly Migration[] = [
  {
    id: 'ura-0001-items',
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
          CHECK (origin_kind IN ('human', 'agent-insight', 'impact-finding', 'chat-answer')),
        insight_id TEXT,
        chat_message_id TEXT,
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
          OR (origin_kind = 'agent-insight' AND insight_id IS NOT NULL AND length(insight_id) = 36
            AND ${allNull(originColumns.filter((column) => column !== 'insight_id'))})
          OR (origin_kind = 'chat-answer' AND chat_message_id IS NOT NULL
            AND trim(chat_message_id) <> ''
            AND ${allNull(originColumns.filter((column) => column !== 'chat_message_id'))})
          OR (origin_kind = 'impact-finding' AND anchor_kind = 'lines'
            AND impact_metric IS NOT NULL AND impact_metric IN ('cognitive-complexity')
            AND impact_function IS NOT NULL AND trim(impact_function) <> ''
            AND impact_value IS NOT NULL AND impact_threshold IS NOT NULL
            AND impact_percentile IS NOT NULL AND impact_percentile BETWEEN 0 AND 100
            AND insight_id IS NULL AND chat_message_id IS NULL)
        ),
        CHECK (
          (status = 'addressed') = (addressed_sha IS NOT NULL)
          AND (status = 'addressed') = (addressed_by IS NOT NULL)
          AND (addressed_sha IS NULL OR addressed_sha <> head_sha)
        )
      ) STRICT;

      CREATE INDEX ura_items_by_session ON ura_items (session_id, position);
      CREATE UNIQUE INDEX ura_items_by_insight ON ura_items (insight_id)
        WHERE insight_id IS NOT NULL;
      CREATE UNIQUE INDEX ura_items_by_finding
        ON ura_items (session_id, head_sha, path, impact_metric, impact_function)
        WHERE origin_kind = 'impact-finding';
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
