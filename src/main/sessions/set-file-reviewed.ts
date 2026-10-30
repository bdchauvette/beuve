import type {
  IpcError,
  SetFileReviewedRequest,
  SetFileReviewedResponse,
} from '#contract/ipc-contract.ts';
import { fileDiffIdFrom } from '#internal/git/file-diff-id-from.ts';
import { removeFileMarks } from '#internal/session/remove-file-marks.ts';
import { setFileMark } from '#internal/session/set-file-mark.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { carryOverReviewMarks } from './carry-over-review-marks.ts';
import { headPathOf } from './head-path-of.ts';
import { loadReviewDiff } from './load-review-diff.ts';
import type { ReviewDiffOptions } from './load-review-diff.ts';
import type { SessionContext } from './session-context.ts';
import { sessionFailure } from './session-failure.ts';

/**
 * Marks one file of the review reviewed at the head (or clears the mark), keyed by the identity of
 * its plain diff (ADR 0064). A renamed file's mark moves to its new path. Refuses `stale-review`
 * when the head is no longer `expectedHeadSha`, and `not-found` for a path outside the review.
 */
export async function setFileReviewed(
  context: SessionContext,
  request: SetFileReviewedRequest,
  options: Pick<ReviewDiffOptions, 'cache'> = {},
): Promise<Result<SetFileReviewedResponse, IpcError>> {
  const diff = await loadReviewDiff(context, request.sessionId, options);
  if (!diff.ok) {
    return diff;
  }
  const { session } = diff.value.refreshed;
  if (request.expectedHeadSha !== session.headSha) {
    return err({
      code: 'stale-review',
      message: 'new commits arrived since this review was loaded; reload it first',
    });
  }
  const file = diff.value.files.find((candidate) => headPathOf(candidate) === request.path);
  if (file === undefined) {
    return err({ code: 'not-found', message: 'that file is not in the review' });
  }
  const oldPath = 'oldPath' in file ? file.oldPath : undefined;
  if (request.reviewed) {
    const stored = setFileMark(
      context.db,
      {
        sessionId: session.id,
        path: request.path,
        diffId: fileDiffIdFrom(file),
        headSha: session.headSha,
        markedAt: Temporal.Now.instant().toString({ fractionalSecondDigits: 3 }),
      },
      oldPath,
    );
    if (!stored.ok) {
      return sessionFailure(context.logger, stored.error);
    }
  } else {
    removeFileMarks(
      context.db,
      session.id,
      oldPath === undefined ? [request.path] : [request.path, oldPath],
    );
  }
  const carried = carryOverReviewMarks(context, session.id, diff.value.files, diff.value.files);
  if (!carried.ok) {
    return carried;
  }
  const index = diff.value.files.indexOf(file);
  return ok({
    sessionId: request.sessionId,
    path: request.path,
    reviewed: carried.value.states[index] ?? 'no',
    progress: {
      total: carried.value.counts.total,
      reviewed: carried.value.counts.reviewed,
      changedSince: carried.value.counts.changedSince,
      unreviewed: carried.value.counts.unreviewed,
    },
  });
}
