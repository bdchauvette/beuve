import type { Migration } from '#sqlite/run-migrations.ts';

/**
 * The session domain's schema (ADR 0006, 0009, 0012, 0037); squashed until the first release. The review state is derived from
 * `checkpoints`, so `sessions` has no denormalized last-checkpoint column.
 */
export const sessionMigrations: readonly Migration[] = [
  {
    id: 'session-0001-initial',
    up: `
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY CHECK (length(id) = 36),
        kind TEXT NOT NULL CHECK (kind IN ('local', 'github-pull-request')),
        repo_path TEXT NOT NULL CHECK (repo_path <> ''),
        base_ref TEXT NOT NULL CHECK (trim(base_ref) <> ''),
        head_ref TEXT,
        owner TEXT,
        repo TEXT,
        pr_number INTEGER,
        head_sha TEXT NOT NULL CHECK (${sha('head_sha')}),
        created_at TEXT NOT NULL CHECK (${timestamp('created_at')}),
        updated_at TEXT NOT NULL CHECK (${timestamp('updated_at')}),
        host TEXT CHECK (
          host IS NULL OR (
            kind = 'github-pull-request'
            AND length(host) BETWEEN 1 AND 253
            AND host NOT GLOB '*[^a-z0-9.-]*'
            AND host NOT GLOB '[.-]*'
          )
        ),
        CHECK (
          (kind = 'local'
            AND head_ref IS NOT NULL AND trim(head_ref) <> ''
            AND owner IS NULL AND repo IS NULL AND pr_number IS NULL)
          OR
          (kind = 'github-pull-request'
            AND head_ref IS NULL
            AND owner IS NOT NULL AND trim(owner) <> ''
            AND repo IS NOT NULL AND trim(repo) <> ''
            AND pr_number IS NOT NULL AND pr_number > 0)
        )
      ) STRICT;

      CREATE UNIQUE INDEX sessions_local_change
        ON sessions (repo_path, base_ref, head_ref) WHERE kind = 'local';
      CREATE UNIQUE INDEX sessions_pull_request
        ON sessions (repo_path, host, owner, repo, pr_number) WHERE kind = 'github-pull-request';
      CREATE INDEX sessions_by_recency ON sessions (updated_at DESC);

      CREATE TABLE checkpoints (
        id TEXT PRIMARY KEY CHECK (length(id) = 36),
        session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
        base_sha TEXT NOT NULL CHECK (${sha('base_sha')}),
        head_sha TEXT NOT NULL CHECK (${sha('head_sha')}),
        created_at TEXT NOT NULL CHECK (${timestamp('created_at')})
      ) STRICT;

      CREATE INDEX checkpoints_by_session ON checkpoints (session_id, created_at);
    `,
  },
];

function sha(column: string): string {
  return `length(${column}) IN (40, 64) AND ${column} NOT GLOB '*[^0-9a-f]*'`;
}

function timestamp(column: string): string {
  return `${column} GLOB '${digits(4)}-${digits(2)}-${digits(2)}T${digits(2)}:${digits(2)}:${digits(2)}.${digits(3)}Z'`;
}

function digits(count: number): string {
  return '[0-9]'.repeat(count);
}
