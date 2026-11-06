import type { DatabaseSync } from 'node:sqlite';

import type { StoredBranch } from './stored-branch.ts';

/** What {@link saveStoredBranch} writes; `fetchedAt` is now. */
export type BranchRecord = Omit<StoredBranch, 'fetchedAt'>;

/** Stores what beuve knows of a followed branch, replacing the previous row (ADR 0112). */
export function saveStoredBranch(db: DatabaseSync, branch: BranchRecord): void {
  db.prepare(
    `INSERT INTO github_branches (
       host, owner, repo, branch, default_branch, html_url, head_sha, state, pull_number,
       fetched_at)
     VALUES (:host, :owner, :repo, :branch, :default_branch, :html_url, :head_sha, :state,
       :pull_number, :fetched_at)
     ON CONFLICT (host, owner, repo, branch) DO UPDATE SET
       default_branch = excluded.default_branch, html_url = excluded.html_url,
       head_sha = excluded.head_sha, state = excluded.state,
       pull_number = excluded.pull_number, fetched_at = excluded.fetched_at;`,
  ).run({
    host: branch.ref.host,
    owner: branch.ref.owner,
    repo: branch.ref.repo,
    branch: branch.ref.branch,
    default_branch: branch.defaultBranch,
    html_url: branch.htmlUrl,
    head_sha: branch.headSha,
    state: branch.state,
    // eslint-disable-next-line unicorn/no-null -- SQLite's NULL.
    pull_number: branch.pullNumber ?? null,
    fetched_at: Temporal.Now.instant().toString({ fractionalSecondDigits: 3 }),
  });
}
