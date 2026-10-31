import type { FileAttributionView, IpcError, ReviewView } from '#contract/ipc-contract.ts';
import type { FileAttribution } from '#internal/git/attribute-hunks.ts';
import type { CommitPairs } from '#internal/git/compute-commit-pairs.ts';
import type { StackForkPoint } from '#internal/git/find-stack-fork-point.ts';
import type { DiffFile } from '#internal/git/diff-model.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { carryOverReviewMarks } from './carry-over-review-marks.ts';
import { loadReviewDiff } from './load-review-diff.ts';
import type { ReviewDiffOptions } from './load-review-diff.ts';
import type { SessionContext } from './session-context.ts';
import { commitPairViewFrom } from './commit-pair-view-from.ts';
import { diffFileViewFrom } from './diff-file-view-from.ts';
import { sessionSummaryFrom } from './session-summary-from.ts';

/** The review as the renderer sees it: {@link loadReviewDiff} mapped to contract views, with each file's reviewed state (ADR 0064). */
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
  const plain =
    options.ignoreWhitespace === true
      ? await loadReviewDiff(context, sessionId, { ...options, ignoreWhitespace: false })
      : diff;
  if (!plain.ok) {
    return plain;
  }
  const carried = carryOverReviewMarks(context, refreshed.session.id, files, plain.value.files);
  if (!carried.ok) {
    return carried;
  }
  return ok({
    session: sessionSummaryFrom(refreshed.session),
    scope,
    baseSha,
    headSha: refreshed.session.headSha,
    files: files.map((file, index) => {
      return {
        ...diffFileViewFrom(file),
        reviewed: carried.value.states[index] ?? 'no',
      };
    }),
    reviewProgress: {
      total: carried.value.counts.total,
      reviewed: carried.value.counts.reviewed,
      changedSince: carried.value.counts.changedSince,
      unreviewed: carried.value.counts.unreviewed,
    },
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
      hunkPairIds: (
        attributed?.hunks ??
        file.hunks.map(() => {
          return [];
        })
      ).map((shas) => {
        return [...shas];
      }),
    };
  });
  return {
    commitPairs: commitPairs.pairs.map((pair) => commitPairViewFrom(pair)),
    fileAttribution,
  };
}
