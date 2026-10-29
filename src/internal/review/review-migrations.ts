import type { Migration } from '#pkg/sqlite/run-migrations.ts';

import { insightCategories } from './insight-categories.ts';
import { insightSeverities } from './insight-severities.ts';
import { insightStatuses } from './insight-statuses.ts';

/**
 * The review domain's schema (ADR 0006, 0019, 0024; squashed until the first release). Both tables reference `sessions`, so main must run
 * the session domain's migrations first. `agent_insights` adapts the spec's `agent_comments`: it
 * records which run (and so which reviewed base and head, and which model) produced each insight.
 */
export const reviewMigrations: readonly Migration[] = [
  {
    id: 'review-0001-initial',
    up: `
      -- path_scope is the JSON array of normalized path prefixes a run covered, '[]' for the
      -- whole change (ADR 0024).
      CREATE TABLE review_runs (
        id TEXT PRIMARY KEY CHECK (length(id) = 36),
        session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
        scope TEXT NOT NULL CHECK (scope IN ('full', 'interdiff')),
        path_scope TEXT NOT NULL DEFAULT '[]'
          CHECK (json_valid(path_scope) AND json_type(path_scope) = 'array'),
        base_sha TEXT NOT NULL CHECK (${sha('base_sha')}),
        head_sha TEXT NOT NULL CHECK (${sha('head_sha')}),
        from_head_sha TEXT CHECK (from_head_sha IS NULL OR ${sha('from_head_sha')}),
        model TEXT NOT NULL CHECK (trim(model) <> ''),
        insight_count INTEGER NOT NULL CHECK (insight_count >= 0),
        dropped_count INTEGER NOT NULL CHECK (dropped_count >= 0),
        created_at TEXT NOT NULL CHECK (${timestamp()}),
        CHECK ((scope = 'interdiff') = (from_head_sha IS NOT NULL)),
        UNIQUE (session_id, head_sha, path_scope)
      ) STRICT;

      CREATE TABLE agent_insights (
        id TEXT PRIMARY KEY CHECK (length(id) = 36),
        run_id TEXT NOT NULL REFERENCES review_runs (id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
        head_sha TEXT NOT NULL CHECK (${sha('head_sha')}),
        path TEXT NOT NULL CHECK (path <> ''),
        line_start INTEGER NOT NULL CHECK (line_start >= 1),
        line_end INTEGER NOT NULL CHECK (line_end >= line_start),
        severity TEXT NOT NULL CHECK (severity IN (${list(insightSeverities)})),
        category TEXT NOT NULL CHECK (category IN (${list(insightCategories)})),
        title TEXT NOT NULL CHECK (trim(title) <> '' AND length(title) <= 200),
        body TEXT NOT NULL CHECK (trim(body) <> ''),
        confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (${list(insightStatuses)})),
        created_at TEXT NOT NULL CHECK (${timestamp()})
      ) STRICT;

      CREATE INDEX agent_insights_by_head ON agent_insights (session_id, head_sha, path, line_start);
      CREATE INDEX agent_insights_by_run ON agent_insights (run_id);
      CREATE INDEX review_runs_by_head ON review_runs (session_id, head_sha, created_at);
    `,
  },
];

function list(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

function sha(column: string): string {
  return `length(${column}) IN (40, 64) AND ${column} NOT GLOB '*[^0-9a-f]*'`;
}

function timestamp(): string {
  return `created_at GLOB '${digits(4)}-${digits(2)}-${digits(2)}T${digits(2)}:${digits(2)}:${digits(2)}.${digits(3)}Z'`;
}

function digits(count: number): string {
  return '[0-9]'.repeat(count);
}
