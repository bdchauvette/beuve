import type { Migration } from '#sqlite/run-migrations.ts';

/**
 * The review-edits domain's schema (ADR 0088). `review_edit_branches` records which local branch
 * beuve made for a session's review edits, so a branch of that name is reused only when it is
 * beuve's for that session. `review_edit_suggestions` remembers which URA item each harvested
 * edit became, keyed by the head and the edit's target lines, so harvesting twice updates or
 * skips instead of duplicating. Both cascade from `sessions`; a suggestion row goes with its item.
 */
export const reviewEditsMigrations: readonly Migration[] = [
  {
    id: 'review-edits-0001-initial',
    up: `
      CREATE TABLE review_edit_branches (
        session_id TEXT PRIMARY KEY REFERENCES sessions (id) ON DELETE CASCADE,
        repo_path TEXT NOT NULL CHECK (repo_path <> ''),
        branch TEXT NOT NULL CHECK (branch <> '' AND branch NOT GLOB '-*'),
        base_sha TEXT NOT NULL CHECK (${sha('base_sha')}),
        created_at TEXT NOT NULL CHECK (created_at <> ''),
        UNIQUE (repo_path, branch)
      ) STRICT;

      CREATE TABLE review_edit_suggestions (
        session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
        head_sha TEXT NOT NULL CHECK (${sha('head_sha')}),
        target TEXT NOT NULL CHECK (target <> ''),
        item_id TEXT NOT NULL REFERENCES ura_items (id) ON DELETE CASCADE,
        fingerprint TEXT NOT NULL CHECK (fingerprint <> ''),
        PRIMARY KEY (session_id, head_sha, target)
      ) STRICT;
    `,
  },
];

function sha(column: string): string {
  return `length(${column}) IN (40, 64) AND ${column} NOT GLOB '*[^0-9a-f]*'`;
}
