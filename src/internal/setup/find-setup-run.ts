import type { DatabaseSync } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { SetupRun, SetupStoreError } from './setup-record.ts';

/** The session's last successful setup, or `undefined` when none is remembered. */
export function findSetupRun(
  db: DatabaseSync,
  sessionId: string,
): Result<SetupRun | undefined, SetupStoreError> {
  const row = db
    .prepare('SELECT head_sha, checkout, finished_at FROM setup_runs WHERE session_id = ?;')
    .get(sessionId);
  if (row === undefined) {
    return ok(undefined);
  }
  const { head_sha, checkout, finished_at } = row;
  if (
    typeof head_sha !== 'string' ||
    typeof checkout !== 'string' ||
    typeof finished_at !== 'string'
  ) {
    return err({ kind: 'corrupt-row', table: 'setup_runs', reason: 'a column is not text' });
  }
  return ok({ sessionId, headSha: head_sha, checkout, finishedAt: finished_at });
}
