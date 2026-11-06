import type { DatabaseSync } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { BranchRef } from './branch-ref.ts';
import type { RepositoryName } from './get-repository.ts';
import type { BranchPullRequestRef, CorruptBranchRow, StoredBranch } from './stored-branch.ts';

/** What beuve last stored of `ref`, or `undefined` when it never followed that branch. */
export function findStoredBranch(
  db: DatabaseSync,
  ref: BranchRef,
): Result<StoredBranch | undefined, CorruptBranchRow> {
  const row = db
    .prepare(
      `SELECT default_branch, html_url, parent_owner, parent_repo, source_owner, source_repo,
              head_sha, state, pull_owner, pull_repo, pull_number, fetched_at
         FROM github_branches WHERE host = ? AND owner = ? AND repo = ? AND branch = ?;`,
    )
    .get(ref.host, ref.owner, ref.repo, ref.branch);
  if (row === undefined) {
    return ok(undefined);
  }
  const {
    default_branch: defaultBranch,
    html_url: htmlUrl,
    head_sha: headSha,
    state,
    fetched_at: fetchedAt,
  } = row;
  const parent = repositoryFrom({ owner: row['parent_owner'], repo: row['parent_repo'] });
  const source = repositoryFrom({ owner: row['source_owner'], repo: row['source_repo'] });
  const pullRequest = pullRequestFrom(row);
  if (
    parent === 'corrupt' ||
    source === 'corrupt' ||
    pullRequest === 'corrupt' ||
    typeof defaultBranch !== 'string' ||
    typeof htmlUrl !== 'string' ||
    typeof headSha !== 'string' ||
    typeof fetchedAt !== 'string' ||
    (state !== 'present' && state !== 'gone')
  ) {
    return err({ kind: 'corrupt-row', table: 'github_branches', reason: 'unexpected values' });
  }
  return ok({
    ref,
    defaultBranch,
    htmlUrl,
    parent,
    source,
    headSha,
    state,
    pullRequest,
    fetchedAt,
  });
}

/** A repository's two columns as read, not yet checked. */
interface RepositoryColumns {
  readonly owner: unknown;
  readonly repo: unknown;
}

function repositoryFrom({
  owner,
  repo,
}: RepositoryColumns): RepositoryName | undefined | 'corrupt' {
  if (owner === null && repo === null) {
    return undefined;
  }
  if (typeof owner === 'string' && typeof repo === 'string') {
    return { owner, repo };
  }
  return 'corrupt';
}

function pullRequestFrom(
  row: Record<string, unknown>,
): BranchPullRequestRef | undefined | 'corrupt' {
  const number = row['pull_number'];
  const repository = repositoryFrom({ owner: row['pull_owner'], repo: row['pull_repo'] });
  if (number === null && repository === undefined) {
    return undefined;
  }
  if (typeof number === 'number' && repository !== undefined && repository !== 'corrupt') {
    return { ...repository, number };
  }
  return 'corrupt';
}
