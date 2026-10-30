import type { IpcError, MarkReviewedRequest, SessionSummary } from '#contract/ipc-contract.ts';
import { findStackForkPoint } from '#internal/git/find-stack-fork-point.ts';
import { insertCheckpoint } from '#internal/session/insert-checkpoint.ts';
import { recordCheckpoint } from '#internal/session/record-checkpoint.ts';
import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import { gitFailure } from './git-failure.ts';
import { loadSession } from './load-session.ts';
import { refreshSession } from './refresh-session.ts';
import type { SessionContext } from './session-context.ts';
import { sessionFailure } from './session-failure.ts';
import { toSessionSummary } from './to-session-summary.ts';

/**
 * Records a checkpoint at the session's current head and the fork point it has from the base
 * branch now (the stack-aware one the review showed, ADR 0054), so the next review is an interdiff from here. Refuses with `stale-review` when the
 * head is no longer `expectedHeadSha`; re-marking an already recorded range changes nothing.
 */
export async function markReviewed(
  context: SessionContext,
  request: MarkReviewedRequest,
): Promise<Result<SessionSummary, IpcError>> {
  const loaded = loadSession(context, request.sessionId);
  if (!loaded.ok) {
    return loaded;
  }
  const refreshed = await refreshSession(context, loaded.value);
  if (!refreshed.ok) {
    return refreshed;
  }
  const { session, repository, baseTip } = refreshed.value;
  if (request.expectedHeadSha !== undefined && request.expectedHeadSha !== session.headSha) {
    return err({
      code: 'stale-review',
      message: 'new commits arrived since this review was loaded; reload it first',
    });
  }
  const { review } = session;
  const fork = await findStackForkPoint(
    repository,
    { base: baseTip, head: session.headSha },
    { reviewedBases: review.kind === 'reviewed' ? [review.checkpoint.baseSha] : [] },
  );
  if (!fork.ok) {
    return gitFailure(context.logger, fork.error);
  }
  const baseSha = fork.value.forkPoint;
  if (
    review.kind === 'reviewed' &&
    review.checkpoint.headSha === session.headSha &&
    review.checkpoint.baseSha === baseSha
  ) {
    return ok(toSessionSummary(session));
  }
  const recorded = recordCheckpoint(session, { baseSha, headSha: session.headSha }, context.deps);
  const inserted = insertCheckpoint(context.db, recorded.checkpoint);
  return inserted.ok
    ? ok(toSessionSummary(recorded.session))
    : sessionFailure(context.logger, inserted.error);
}
