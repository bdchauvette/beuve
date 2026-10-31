import type { DatabaseSync } from 'node:sqlite';

import type { PullRequest, PullRequestRef } from './pull-request.ts';

/**
 * Stores what GitHub reported for `ref`, replacing the previous metadata (ADR 0037). `ref` is the
 * pull request's canonical location (its base repository), which a renamed repository changes.
 */
export function savePullRequest(
  db: DatabaseSync,
  ref: PullRequestRef,
  pullRequest: PullRequest,
): void {
  db.prepare(
    `INSERT INTO github_pull_requests (
       host, owner, repo, number, title, body, author, state, is_draft, html_url,
       base_branch, base_sha, head_branch, head_sha, is_cross_repository,
       github_updated_at, fetched_at)
     VALUES (:host, :owner, :repo, :number, :title, :body, :author, :state, :is_draft, :html_url,
       :base_branch, :base_sha, :head_branch, :head_sha, :is_cross_repository,
       :github_updated_at, :fetched_at)
     ON CONFLICT (host, owner, repo, number) DO UPDATE SET
       title = excluded.title, body = excluded.body, author = excluded.author,
       state = excluded.state, is_draft = excluded.is_draft, html_url = excluded.html_url,
       base_branch = excluded.base_branch, base_sha = excluded.base_sha,
       head_branch = excluded.head_branch, head_sha = excluded.head_sha,
       is_cross_repository = excluded.is_cross_repository,
       github_updated_at = excluded.github_updated_at, fetched_at = excluded.fetched_at;`,
  ).run({
    host: ref.host,
    owner: ref.owner,
    repo: ref.repo,
    number: ref.number,
    title: pullRequest.title,
    body: pullRequest.body,
    author: pullRequest.author,
    state: pullRequest.state,
    is_draft: sqliteBoolean(pullRequest.isDraft),
    html_url: pullRequest.htmlUrl,
    base_branch: pullRequest.base.ref,
    base_sha: pullRequest.base.sha,
    head_branch: pullRequest.head.ref,
    head_sha: pullRequest.head.sha,
    is_cross_repository: sqliteBoolean(pullRequest.isCrossRepository),
    github_updated_at: pullRequest.updatedAt,
    fetched_at: Temporal.Now.instant().toString({ fractionalSecondDigits: 3 }),
  });
}

/** SQLite has no boolean: `1` or `0`. */
function sqliteBoolean(isTrue: boolean): number {
  if (isTrue) {
    return 1;
  }
  return 0;
}
