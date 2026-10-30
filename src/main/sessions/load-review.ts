import type { FileAttributionView, IpcError, ReviewView } from '#contract/ipc-contract.ts';
import type { FileAttribution } from '#internal/git/attribute-hunks.ts';
import type { CommitPairs } from '#internal/git/compute-commit-pairs.ts';
import type { StackForkPoint } from '#internal/git/find-stack-fork-point.ts';
import type { DiffFile } from '#internal/git/diff-model.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { loadReviewDiff } from './load-review-diff.ts';
import type { ReviewDiffOptions } from './load-review-diff.ts';
import type { SessionContext } from './session-context.ts';
import { commitPairViewFrom } from './commit-pair-view-from.ts';
import { diffFileViewFrom } from './diff-file-view-from.ts';
import { sessionSummaryFrom } from './session-summary-from.ts';

/** The review as the renderer sees it: {@link loadReviewDiff} mapped to contract views. */
export async function loadReview(
  context: SessionContext,
  sessionId: string,
  options: ReviewDiffOptions = {},
): Promise<Result<ReviewView, IpcError>> {
  const diff = await loadReviewDiff(context, sessionId, options);
  if (!diff.ok) {
    return diff;
  }
  const { refreshed, scope, baseSha, files, forkPoint, commitPairs, attribution } = diff.value;
  return ok({
    session: sessionSummaryFrom(refreshed.session),
    scope,
    baseSha,
    headSha: refreshed.session.headSha,
    files: files.map((file) => diffFileViewFrom(file)),
    whitespace: options.ignoreWhitespace === true ? 'ignored' : 'shown',
    ...forkPointViewFrom(forkPoint),
    ...pairingViewsFrom(files, commitPairs, attribution),
  });
}

function forkPointViewFrom(forkPoint: StackForkPoint | undefined): Pick<ReviewView, 'forkPoint'> {
  return forkPoint === undefined || forkPoint.reason === 'merge-base'
    ? {}
    : {
        forkPoint: {
          reason: forkPoint.reason,
          mergeBaseSha: forkPoint.mergeBase,
          skippedCommits: forkPoint.skipped,
        },
      };
}

/** Pair ids are the new commit's sha, so a hunk's attributed commits are already its pair ids. */
function pairingViewsFrom(
  files: readonly DiffFile[],
  commitPairs: CommitPairs | undefined,
  attribution: readonly FileAttribution[] | undefined,
): Pick<ReviewView, 'commitPairs' | 'fileAttribution'> {
  if (commitPairs === undefined) {
    return {};
  }
  const fileAttribution: FileAttributionView[] = files.map((file, index) => {
    const attributed = attribution?.[index];
    return {
      path: 'newPath' in file ? file.newPath : file.path,
      pairIds: [...(attributed?.commits ?? [])],
      hunkPairIds: (attributed?.hunks ?? file.hunks.map(() => [])).map((shas) => [...shas]),
    };
  });
  return {
    commitPairs: commitPairs.pairs.map((pair) => commitPairViewFrom(pair)),
    fileAttribution,
  };
}
