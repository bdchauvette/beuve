import type { DatabaseSync } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';
import { withTransaction } from '#x/sqlite/with-transaction.ts';

import { serializePathScope } from './serialize-path-scope.ts';
import type { AgentInsight, ReviewRun, ReviewStoreError } from './agent-insight.ts';
import { carryOverStoredStatuses } from './carry-over-stored-statuses.ts';
import { insertReviewRun } from './insert-review-run.ts';

type ReplaceError = Extract<ReviewStoreError, { kind: 'session-not-found' | 'duplicate-run' }>;

/**
 * Like {@link insertReviewRun}, but first deletes the stored run for the same (session, head,
 * path scope): a rerun the reviewer asked for (`/review --fresh`). The old insights' promoted and
 * dismissed statuses carry over to matching new insights (ADR 0024). Atomic, so a failed insert
 * keeps the old run. Answers whether a run was replaced.
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
      const carried = carryOverStoredStatuses(db, run, insights);
      const { changes } = db
        .prepare(
          'DELETE FROM review_runs WHERE session_id = ? AND head_sha = ? AND path_scope = ?;',
        )
        .run(run.sessionId, run.headSha, serializePathScope(run.pathScope));
      const inserted = insertReviewRun(db, run, carried);
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
