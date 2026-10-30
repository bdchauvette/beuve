import type { DatabaseSync } from 'node:sqlite';

import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { CommitSha, ReviewRun, ReviewStoreError, SessionId } from './agent-insight.ts';
import { rowToReviewRun } from './row-to-review-run.ts';
import { serializePathScope } from './serialize-path-scope.ts';

/**
 * The completed run for a (session, head, path scope), if there is one: main skips scheduling
 * another. `pathScope` is normalized here, so callers may pass the prefixes as typed.
 */
export function findReviewRun(
  db: DatabaseSync,
  sessionId: SessionId,
  headSha: CommitSha,
  pathScope: readonly string[] = [],
): Result<ReviewRun | undefined, Extract<ReviewStoreError, { kind: 'corrupt-row' }>> {
  const row = db
    .prepare('SELECT * FROM review_runs WHERE session_id = ? AND head_sha = ? AND path_scope = ?;')
    .get(sessionId, headSha, serializePathScope(pathScope));
  return row === undefined ? ok(undefined) : rowToReviewRun(row);
}
