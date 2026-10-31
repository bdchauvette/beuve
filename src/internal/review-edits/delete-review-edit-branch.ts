import type { DatabaseSync } from 'node:sqlite';

/**
 * Forgets a session's review-edits branch and the suggestions harvested from it, once the
 * branch and its worktree are gone (Discard Review Edits). The URA items stay.
 */
export function deleteReviewEditBranch(db: DatabaseSync, sessionId: string): void {
  db.prepare('DELETE FROM review_edit_suggestions WHERE session_id = ?;').run(sessionId);
  db.prepare('DELETE FROM review_edit_branches WHERE session_id = ?;').run(sessionId);
}
