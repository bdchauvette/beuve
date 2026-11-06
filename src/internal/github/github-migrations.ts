import type { Migration } from '#sqlite/run-migrations.ts';

/**
 * The github domain's schema (ADR 0006, 0037, 0112 and its fork amendment): the last pull request and followed-branch
 * metadata GitHub reported, keyed by the pull request or branch itself rather than a session, so
 * two clones reviewing one change share it and nothing here depends on the session domain's
 * tables. No tokens, ETags or CI results are stored.
 */
export const githubMigrations: readonly Migration[] = [
  {
    id: 'github-0001-initial',
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

      CREATE TABLE github_branches (
        host TEXT NOT NULL CHECK (host <> '' AND host NOT GLOB '*[^a-z0-9.-]*'),
        owner TEXT NOT NULL CHECK (owner <> ''),
        repo TEXT NOT NULL CHECK (repo <> ''),
        branch TEXT NOT NULL CHECK (branch <> ''),
        default_branch TEXT NOT NULL CHECK (default_branch <> ''),
        html_url TEXT NOT NULL CHECK (html_url GLOB 'https://*'),
        parent_owner TEXT CHECK (parent_owner <> ''),
        parent_repo TEXT CHECK (parent_repo <> ''),
        source_owner TEXT CHECK (source_owner <> ''),
        source_repo TEXT CHECK (source_repo <> ''),
        head_sha TEXT NOT NULL CHECK (${sha('head_sha')}),
        state TEXT NOT NULL CHECK (state IN ('present', 'gone')),
        pull_owner TEXT CHECK (pull_owner <> ''),
        pull_repo TEXT CHECK (pull_repo <> ''),
        pull_number INTEGER CHECK (pull_number IS NULL OR pull_number > 0),
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (host, owner, repo, branch),
        CHECK ((parent_owner IS NULL) = (parent_repo IS NULL)),
        CHECK ((source_owner IS NULL) = (source_repo IS NULL)),
        CHECK ((pull_owner IS NULL) = (pull_number IS NULL)
          AND (pull_repo IS NULL) = (pull_number IS NULL))
      ) STRICT;
    `,
  },
];

function sha(column: string): string {
  return `length(${column}) IN (40, 64) AND ${column} NOT GLOB '*[^0-9a-f]*'`;
}
