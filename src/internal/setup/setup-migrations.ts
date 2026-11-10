import type { Migration } from '#sqlite/run-migrations.ts';

/**
 * The setup domain's schema (ADR 0130). `setup_commands` holds the reviewer's setup command per
 * repository, keyed by the repository's remote as `host/owner/repo` in lowercase, so it carries
 * across the sessions and pull requests of one repository and never lives in the repository.
 * `setup_runs` remembers the last head of a session whose checkout the command set up, and in
 * which checkout, so the offer to run it stops for that head; it cascades from `sessions`.
 */
export const setupMigrations: readonly Migration[] = [
  {
    id: 'setup-0001-initial',
    up: `
      CREATE TABLE setup_commands (
        repository TEXT PRIMARY KEY CHECK (repository <> '' AND repository = lower(repository)),
        command TEXT NOT NULL CHECK (command <> ''),
        updated_at TEXT NOT NULL CHECK (updated_at <> '')
      ) STRICT;

      CREATE TABLE setup_runs (
        session_id TEXT PRIMARY KEY REFERENCES sessions (id) ON DELETE CASCADE,
        head_sha TEXT NOT NULL CHECK (${sha('head_sha')}),
        checkout TEXT NOT NULL CHECK (checkout <> ''),
        finished_at TEXT NOT NULL CHECK (finished_at <> '')
      ) STRICT;

      CREATE INDEX setup_runs_checkout ON setup_runs (checkout);
    `,
  },
];

function sha(column: string): string {
  return `length(${column}) IN (40, 64) AND ${column} NOT GLOB '*[^0-9a-f]*'`;
}
