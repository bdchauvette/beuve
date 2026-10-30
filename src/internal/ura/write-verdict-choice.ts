import type { DatabaseSync } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { sqliteErrorCode } from '#sqlite/sqlite-error-code.ts';
import type { SessionId, UraStoreError } from './ura-item.ts';
import type { UraVerdictChoice } from './ura-verdict-choice.ts';

const foreignKeyViolation = 787;

/**
 * Replaces the session's verdict choice. An empty choice (no `chosen`, no `cleared`) deletes the
 * row; a `chosen` verdict is stored with its `headSha`. A session that doesn't exist is
 * `session-not-found`.
 */
export function writeVerdictChoice(
  db: DatabaseSync,
  sessionId: SessionId,
  choice: UraVerdictChoice,
  now: Temporal.Instant,
): Result<void, Extract<UraStoreError, { kind: 'session-not-found' }>> {
  const stored = choice.chosen ?? choice.cleared;
  if (stored === undefined || (choice.chosen !== undefined && choice.headSha === undefined)) {
    db.prepare('DELETE FROM ura_verdict_choices WHERE session_id = ?;').run(sessionId);
    return ok(undefined);
  }
  try {
    db.prepare(
      `INSERT INTO ura_verdict_choices (session_id, verdict, cleared_reason, head_sha, updated_at)
       VALUES (:session_id, iif(:is_choice, :stored, NULL), iif(:is_choice, NULL, :stored),
               iif(:is_choice, :head_sha, NULL), :updated_at)
       ON CONFLICT (session_id) DO UPDATE
         SET verdict = excluded.verdict, cleared_reason = excluded.cleared_reason,
             head_sha = excluded.head_sha, updated_at = excluded.updated_at;`,
    ).run({
      session_id: sessionId,
      is_choice: choice.chosen === undefined ? 0 : 1,
      stored,
      head_sha: choice.headSha ?? '',
      updated_at: now.toString({ fractionalSecondDigits: 3 }),
    });
  } catch (error: unknown) {
    if (sqliteErrorCode(error) === foreignKeyViolation) {
      return err({ kind: 'session-not-found', sessionId });
    }
    throw error;
  }
  return ok(undefined);
}
