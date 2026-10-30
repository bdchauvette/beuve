import type { DatabaseSync } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';
import { sqliteErrorCode } from '#sqlite/sqlite-error-code.ts';
import { withTransaction } from '#sqlite/with-transaction.ts';

import type { FileMark, SessionError } from './session.ts';

const foreignKeyViolation = 787;

/**
 * Stores a file mark, replacing the session's mark for that path. `replacesPath` is the file's
 * old name when it was renamed: that mark is removed in the same transaction, so a rename moves
 * the mark instead of leaving a stale one behind.
 */
export function setFileMark(
  db: DatabaseSync,
  mark: FileMark,
  replacesPath?: string,
): Result<void, Extract<SessionError, { kind: 'session-not-found' }>> {
  try {
    withTransaction(db, () => {
      if (replacesPath !== undefined && replacesPath !== mark.path) {
        db.prepare('DELETE FROM file_marks WHERE session_id = ? AND path = ?;').run(
          mark.sessionId,
          replacesPath,
        );
      }
      db.prepare(
        `INSERT INTO file_marks (session_id, path, diff_id, head_sha, marked_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (session_id, path) DO UPDATE SET
           diff_id = excluded.diff_id, head_sha = excluded.head_sha, marked_at = excluded.marked_at;`,
      ).run(mark.sessionId, mark.path, mark.diffId, mark.headSha, mark.markedAt);
    });
  } catch (error: unknown) {
    if (sqliteErrorCode(error) === foreignKeyViolation) {
      return err({ kind: 'session-not-found', sessionId: mark.sessionId });
    }
    throw error;
  }
  return ok(undefined);
}
