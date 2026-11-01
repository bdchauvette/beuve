import type { Migration } from '#sqlite/run-migrations.ts';

/**
 * The dependency-install domain's schema (ADR 0089, 0090, 0092).
 *
 * - `dependency_installs`: one row per beuve checkout (its path), shared by every session at that
 *   commit: the install's state, the tools and versions it used, why it failed, and its log's
 *   tail. A checkout checked out afresh or removed drops its row.
 * - `dependency_decisions`: the lockfile safeguard's answer per session head; cascades from
 *   `sessions`.
 * - `dependency_repository_settings`: per repository (real path), the safeguard switch and the
 *   Settings override of `.beuve/config.json`, as JSON text.
 * - `dependency_tool_paths`: per tool executable, a directory searched first.
 */
export const depsMigrations: readonly Migration[] = [
  {
    id: 'deps-0001-initial',
    up: `
      CREATE TABLE dependency_installs (
        checkout_path TEXT PRIMARY KEY CHECK (checkout_path <> ''),
        repo_path TEXT NOT NULL CHECK (repo_path <> ''),
        commit_sha TEXT NOT NULL CHECK (${sha('commit_sha')}),
        state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'done', 'failed', 'declined')),
        tools TEXT NOT NULL CHECK (json_valid(tools)),
        reason TEXT,
        log_tail TEXT NOT NULL,
        updated_at TEXT NOT NULL CHECK (updated_at <> '')
      ) STRICT;

      CREATE TABLE dependency_decisions (
        session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
        head_sha TEXT NOT NULL CHECK (${sha('head_sha')}),
        decision TEXT NOT NULL CHECK (decision IN ('install', 'decline')),
        inputs TEXT NOT NULL CHECK (json_valid(inputs)),
        decided_at TEXT NOT NULL CHECK (decided_at <> ''),
        PRIMARY KEY (session_id, head_sha)
      ) STRICT;

      CREATE TABLE dependency_repository_settings (
        repo_path TEXT PRIMARY KEY CHECK (repo_path <> ''),
        safeguard INTEGER NOT NULL CHECK (safeguard IN (0, 1)),
        install_override TEXT
      ) STRICT;

      CREATE TABLE dependency_tool_paths (
        executable TEXT PRIMARY KEY CHECK (executable <> ''),
        directory TEXT NOT NULL CHECK (directory <> '')
      ) STRICT;
    `,
  },
];

function sha(column: string): string {
  return `length(${column}) IN (40, 64) AND ${column} NOT GLOB '*[^0-9a-f]*'`;
}
