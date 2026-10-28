import type { Migration } from '#pkg/sqlite/run-migrations.ts';

/**
 * The github domain's schema (ADR 0006, 0037): the last pull request metadata GitHub reported,
 * keyed by the pull request itself rather than a session, so two clones reviewing one pull
 * request share it and nothing here depends on the session domain's tables. No tokens, ETags or
 * CI results are stored.
 */
export const githubMigrations: readonly Migration[] = [
  {
    id: 'github-0001-pull-requests',
    up: `
      CREATE TABLE github_pull_requests (
        host TEXT NOT NULL CHECK (host <> '' AND host NOT GLOB '*[^a-z0-9.-]*'),
        owner TEXT NOT NULL CHECK (owner <> ''),
        repo TEXT NOT NULL CHECK (repo <> ''),
        number INTEGER NOT NULL CHECK (number > 0),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        author TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('open', 'closed', 'merged')),
        is_draft INTEGER NOT NULL CHECK (is_draft IN (0, 1)),
        html_url TEXT NOT NULL CHECK (html_url GLOB 'https://*'),
        base_branch TEXT NOT NULL CHECK (base_branch <> ''),
        base_sha TEXT NOT NULL CHECK (${sha('base_sha')}),
        head_branch TEXT NOT NULL,
        head_sha TEXT NOT NULL CHECK (${sha('head_sha')}),
        is_cross_repository INTEGER NOT NULL CHECK (is_cross_repository IN (0, 1)),
        github_updated_at TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (host, owner, repo, number)
      ) STRICT;
    `,
  },
];

function sha(column: string): string {
  return `length(${column}) IN (40, 64) AND ${column} NOT GLOB '*[^0-9a-f]*'`;
}
