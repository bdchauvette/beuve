import type { IpcError, SessionSummary, UndoMarkReviewedRequest } from '#contract/ipc-contract.ts';
import { deleteLatestCheckpoint } from '#internal/session/delete-latest-checkpoint.ts';
import { parseCheckpointId } from '#internal/session/parse-checkpoint-id.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { loadSession } from './load-session.ts';
import type { SessionContext } from './session-context.ts';
import { sessionFailure } from './session-failure.ts';
import { sessionSummaryFrom } from './session-summary-from.ts';

/**
 * Undo Save Progress (ADR 0142): removes the checkpoint the save recorded while it is still the
 * session's latest, so the review shows again what it showed before the save. Refuses once
 * progress was saved again. File marks and notes are untouched: saving never changed them.
 */
export function undoMarkReviewed(
  context: SessionContext,
  request: UndoMarkReviewedRequest,
): Result<SessionSummary, IpcError> {
  const loaded = loadSession(context, request.sessionId);
  if (!loaded.ok) {
    return loaded;
  }
  const checkpointId = parseCheckpointId(request.checkpointId);
  if (!checkpointId.ok) {
    return sessionFailure(context.logger, checkpointId.error);
  }
  const deleted = deleteLatestCheckpoint(context.db, loaded.value.id, checkpointId.value);
  if (!deleted.ok) {
    return sessionFailure(context.logger, deleted.error);
  }
  const reloaded = loadSession(context, request.sessionId);
  if (!reloaded.ok) {
    return reloaded;
  }
  return ok(sessionSummaryFrom(reloaded.value));
}
