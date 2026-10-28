import type { DatabaseSync } from 'node:sqlite';

import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import type { CommitSha, ReviewRun, ReviewStoreError, SessionId } from './agent-insight.ts';
import { rowToReviewRun } from './row-to-review-run.ts';

/** The completed run for a (session, head), if there is one: main skips scheduling another. */
export function findReviewRun(
  db: DatabaseSync,
  sessionId: SessionId,
  headSha: CommitSha,
): Result<ReviewRun | undefined, Extract<ReviewStoreError, { kind: 'corrupt-row' }>> {
  const row = db
    .prepare('SELECT * FROM review_runs WHERE session_id = ? AND head_sha = ?;')
    .get(sessionId, headSha);
  return row === undefined ? ok(undefined) : rowToReviewRun(row);
}
