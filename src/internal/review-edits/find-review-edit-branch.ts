import type { DatabaseSync } from 'node:sqlite';

import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { ReviewEditBranch, ReviewEditsStoreError } from './review-edit-branch.ts';
import { reviewEditBranchFromRow } from './review-edit-branch-from-row.ts';

/** Where to look a branch up: by the session it belongs to, or by repository and name. */
export type ReviewEditBranchLookup =
  { readonly sessionId: string } | { readonly repoPath: string; readonly branch: string };

/** The review-edits branch a lookup names, or `undefined` when beuve made none. */
export function findReviewEditBranch(
  db: DatabaseSync,
  lookup: ReviewEditBranchLookup,
): Result<ReviewEditBranch | undefined, ReviewEditsStoreError> {
  let row;
  if ('sessionId' in lookup) {
    row = db
      .prepare('SELECT * FROM review_edit_branches WHERE session_id = ?;')
      .get(lookup.sessionId);
  } else {
    row = db
      .prepare('SELECT * FROM review_edit_branches WHERE repo_path = ? AND branch = ?;')
      .get(lookup.repoPath, lookup.branch);
  }
  if (row === undefined) {
    return ok(undefined);
  }
  return reviewEditBranchFromRow(row);
}
