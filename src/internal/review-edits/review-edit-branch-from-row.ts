import type { SQLOutputValue } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type {
  CommitSha,
  ReviewEditBranch,
  ReviewEditsStoreError,
  SessionId,
} from './review-edit-branch.ts';

/** A `review_edit_branches` row as a record, or `corrupt-row` when a column has the wrong type. */
export function reviewEditBranchFromRow(
  row: Record<string, SQLOutputValue>,
): Result<ReviewEditBranch, ReviewEditsStoreError> {
  const { session_id, repo_path, branch, base_sha, created_at } = row;
  if (
    typeof session_id !== 'string' ||
    typeof repo_path !== 'string' ||
    typeof branch !== 'string' ||
    typeof base_sha !== 'string' ||
    typeof created_at !== 'string'
  ) {
    return err({
      kind: 'corrupt-row',
      table: 'review_edit_branches',
      reason: 'a column is not text',
    });
  }
  return ok({
    sessionId: session_id as SessionId,
    repoPath: repo_path,
    branch,
    baseSha: base_sha as CommitSha,
    createdAt: created_at,
  });
}
