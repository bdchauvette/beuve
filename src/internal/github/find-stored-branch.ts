import type { DatabaseSync } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { BranchRef } from './branch-ref.ts';
import type { CorruptBranchRow, StoredBranch } from './stored-branch.ts';

/** What beuve last stored of `ref`, or `undefined` when it never followed that branch. */
export function findStoredBranch(
  db: DatabaseSync,
  ref: BranchRef,
): Result<StoredBranch | undefined, CorruptBranchRow> {
  const row = db
    .prepare(
      `SELECT default_branch, html_url, head_sha, state, pull_number, fetched_at
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
    pull_number: pullNumber,
    fetched_at: fetchedAt,
  } = row;
  if (
    typeof defaultBranch !== 'string' ||
    typeof htmlUrl !== 'string' ||
    typeof headSha !== 'string' ||
    typeof fetchedAt !== 'string' ||
    (state !== 'present' && state !== 'gone') ||
    (pullNumber !== null && typeof pullNumber !== 'number')
  ) {
    return err({ kind: 'corrupt-row', table: 'github_branches', reason: 'unexpected values' });
  }
  return ok({
    ref,
    defaultBranch,
    htmlUrl,
    headSha,
    state,
    pullNumber: pullNumber ?? undefined,
    fetchedAt,
  });
}
