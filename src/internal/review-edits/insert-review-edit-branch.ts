import type { DatabaseSync } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { ReviewEditBranch, ReviewEditsStoreError } from './review-edit-branch.ts';

/**
 * Records that beuve owns `record.branch` for its session. Refuses a session that already has
 * one (`session-taken`) and a branch another session owns in that repository (`branch-taken`).
 */
export function insertReviewEditBranch(
  db: DatabaseSync,
  record: ReviewEditBranch,
): Result<undefined, ReviewEditsStoreError> {
  try {
    db.prepare(
      `INSERT INTO review_edit_branches (session_id, repo_path, branch, base_sha, created_at)
        VALUES (?, ?, ?, ?, ?);`,
    ).run(record.sessionId, record.repoPath, record.branch, record.baseSha, record.createdAt);
    return ok(undefined);
  } catch (error: unknown) {
    const message = (error as Error).message;
    if (message.includes('review_edit_branches.session_id')) {
      return err({ kind: 'session-taken', sessionId: record.sessionId });
    }
    if (message.includes('UNIQUE')) {
      return err({ kind: 'branch-taken', repoPath: record.repoPath, branch: record.branch });
    }
    throw error;
  }
}
