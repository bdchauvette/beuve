import type { DatabaseSync } from 'node:sqlite';

import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { CommitSha, ReviewRun, ReviewStoreError, SessionId } from './agent-insight.ts';
import { rowToReviewRun } from './row-to-review-run.ts';

/** Every stored run of a session at one head, whatever its path scope, newest first. */
export function listReviewRuns(
  db: DatabaseSync,
  sessionId: SessionId,
  headSha: CommitSha,
): Result<ReviewRun[], Extract<ReviewStoreError, { kind: 'corrupt-row' }>> {
  const rows = db
    .prepare(
      `SELECT * FROM review_runs WHERE session_id = ? AND head_sha = ?
        ORDER BY created_at DESC, rowid DESC;`,
    )
    .all(sessionId, headSha);
  const runs: ReviewRun[] = [];
  for (const row of rows) {
    const run = rowToReviewRun(row);
    if (!run.ok) {
      return run;
    }
    runs.push(run.value);
  }
  return ok(runs);
}
