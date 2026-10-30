import type { DatabaseSync } from 'node:sqlite';

import type { SessionId } from './session.ts';

/** Removes the session's marks for these paths; paths without a mark are ignored. */
export function removeFileMarks(
  db: DatabaseSync,
  sessionId: SessionId,
  paths: readonly string[],
): void {
  const remove = db.prepare('DELETE FROM file_marks WHERE session_id = ? AND path = ?;');
  for (const path of paths) {
    remove.run(sessionId, path);
  }
}
