import type { DatabaseSync } from 'node:sqlite';

import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';
import { withTransaction } from '#pkg/sqlite/with-transaction.ts';

import type { AgentInsight, ReviewRun, ReviewStoreError } from './agent-insight.ts';
import { insertReviewRun } from './insert-review-run.ts';

type ReplaceError = Extract<ReviewStoreError, { kind: 'session-not-found' | 'duplicate-run' }>;

/**
 * Like {@link insertReviewRun}, but first deletes the stored run for the same (session, head) and
 * its insights, statuses included: a rerun the reviewer asked for (`/review --fresh`). Atomic, so a
 * failed insert keeps the old run. Answers whether a run was replaced.
 */
export function replaceReviewRun(
  db: DatabaseSync,
  run: ReviewRun,
  insights: readonly AgentInsight[],
): Result<boolean, ReplaceError> {
  let failure: ReplaceError | undefined;
  const rollback = new Error('replaceReviewRun: roll back');
  try {
    const isReplaced = withTransaction(db, () => {
      const { changes } = db
        .prepare('DELETE FROM review_runs WHERE session_id = ? AND head_sha = ?;')
        .run(run.sessionId, run.headSha);
      const inserted = insertReviewRun(db, run, insights);
      if (!inserted.ok) {
        failure = inserted.error;
        throw rollback;
      }
      return Number(changes) > 0;
    });
    return ok(isReplaced);
  } catch (error: unknown) {
    if (error === rollback && failure !== undefined) {
      return err(failure);
    }
    throw error;
  }
}
