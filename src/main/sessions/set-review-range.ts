import type { IpcError, SessionSummary, SetReviewRangeRequest } from '#contract/ipc-contract.ts';
import { parseCheckpointId } from '#internal/session/parse-checkpoint-id.ts';
import type { ReviewRangeSelection } from '#internal/session/session.ts';
import { setReviewRangeChoice } from '#internal/session/set-review-range-choice.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { loadSession } from './load-session.ts';
import type { SessionContext } from './session-context.ts';
import { sessionFailure } from './session-failure.ts';
import { sessionSummaryFrom } from './session-summary-from.ts';

/**
 * Stores which range the session's review shows (ADR 0142): since the last saved progress, the
 * whole change, or since an earlier saved progress of this session. Every review read follows it
 * (the diff, its order, files, notes and chat), so they all describe the same diff.
 */
export function setReviewRange(
  context: SessionContext,
  request: SetReviewRangeRequest,
): Result<SessionSummary, IpcError> {
  const loaded = loadSession(context, request.sessionId);
  if (!loaded.ok) {
    return loaded;
  }
  const { range } = request;
  let selection: ReviewRangeSelection;
  if (range.kind === 'since-checkpoint') {
    const checkpointId = parseCheckpointId(range.checkpointId);
    if (!checkpointId.ok) {
      return sessionFailure(context.logger, checkpointId.error);
    }
    selection = { kind: 'since-checkpoint', checkpointId: checkpointId.value };
  } else {
    selection = range;
  }
  const stored = setReviewRangeChoice(context.db, loaded.value.id, selection);
  if (!stored.ok) {
    return sessionFailure(context.logger, stored.error);
  }
  return ok(sessionSummaryFrom(loaded.value));
}
