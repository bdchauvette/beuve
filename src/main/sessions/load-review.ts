import type { IpcError, ReviewView } from '#contract/ipc-contract.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import { loadReviewDiff } from './load-review-diff.ts';
import type { SessionContext } from './session-context.ts';
import { toDiffFileView } from './to-diff-file-view.ts';
import { toSessionSummary } from './to-session-summary.ts';

/** The review as the renderer sees it: {@link loadReviewDiff} mapped to contract views. */
export async function loadReview(
  context: SessionContext,
  sessionId: string,
): Promise<Result<ReviewView, IpcError>> {
  const diff = await loadReviewDiff(context, sessionId);
  if (!diff.ok) {
    return diff;
  }
  const { refreshed, scope, baseSha, files } = diff.value;
  return ok({
    session: toSessionSummary(refreshed.session),
    scope,
    baseSha,
    headSha: refreshed.session.headSha,
    files: files.map((file) => toDiffFileView(file)),
  });
}
