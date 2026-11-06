import type { DatabaseSync } from 'node:sqlite';

import type { StoredBranch } from './stored-branch.ts';

/** What {@link saveStoredBranch} writes; `fetchedAt` is now. */
export type BranchRecord = Omit<StoredBranch, 'fetchedAt'>;

/** Stores what beuve knows of a followed branch, replacing the previous row (ADR 0112). */
export function saveStoredBranch(db: DatabaseSync, branch: BranchRecord): void {
  db.prepare(
    `INSERT INTO github_branches (
       host, owner, repo, branch, default_branch, html_url, parent_owner, parent_repo,
       source_owner, source_repo, head_sha, state, pull_owner, pull_repo, pull_number, fetched_at)
     VALUES (:host, :owner, :repo, :branch, :default_branch, :html_url, :parent_owner,
       :parent_repo, :source_owner, :source_repo, :head_sha, :state, :pull_owner, :pull_repo,
       :pull_number, :fetched_at)
     ON CONFLICT (host, owner, repo, branch) DO UPDATE SET
       default_branch = excluded.default_branch, html_url = excluded.html_url,
       parent_owner = excluded.parent_owner, parent_repo = excluded.parent_repo,
       source_owner = excluded.source_owner, source_repo = excluded.source_repo,
       head_sha = excluded.head_sha, state = excluded.state,
       pull_owner = excluded.pull_owner, pull_repo = excluded.pull_repo,
       pull_number = excluded.pull_number, fetched_at = excluded.fetched_at;`,
  ).run({
    host: branch.ref.host,
    owner: branch.ref.owner,
    repo: branch.ref.repo,
    branch: branch.ref.branch,
    default_branch: branch.defaultBranch,
    html_url: branch.htmlUrl,
    parent_owner: nullable(branch.parent?.owner),
    parent_repo: nullable(branch.parent?.repo),
    source_owner: nullable(branch.source?.owner),
    source_repo: nullable(branch.source?.repo),
    head_sha: branch.headSha,
    state: branch.state,
    pull_owner: nullable(branch.pullRequest?.owner),
    pull_repo: nullable(branch.pullRequest?.repo),
    pull_number: nullable(branch.pullRequest?.number),
    fetched_at: Temporal.Now.instant().toString({ fractionalSecondDigits: 3 }),
  });
}

function nullable<T extends string | number>(value: T | undefined): T | null {
  // eslint-disable-next-line unicorn/no-null -- SQLite's NULL.
  return value ?? null;
}
