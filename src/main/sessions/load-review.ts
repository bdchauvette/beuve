import type { FileAttributionView, IpcError, ReviewView } from '#contract/ipc-contract.ts';
import type { FileAttribution } from '#internal/git/attribute-hunks.ts';
import type { CommitPairs } from '#internal/git/compute-commit-pairs.ts';
import type { StackForkPoint } from '#internal/git/find-stack-fork-point.ts';
import type { DiffFile } from '#internal/git/diff-model.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { carryOverReviewMarks } from './carry-over-review-marks.ts';
import { headPathOf } from './head-path-of.ts';
import { loadReviewDiff } from './load-review-diff.ts';
import { readShebangs } from './read-shebangs.ts';
import type { ReviewDiff, ReviewDiffOptions } from './load-review-diff.ts';
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
  let plain: Result<ReviewDiff, IpcError> = diff;
  if (options.ignoreWhitespace === true) {
    plain = await loadReviewDiff(context, sessionId, { ...options, ignoreWhitespace: false });
  }
  if (!plain.ok) {
    return plain;
  }
  const carried = carryOverReviewMarks(context, refreshed.session.id, {
    shown: files,
    identified: plain.value.files,
  });
  if (!carried.ok) {
    return carried;
  }
  const shebangs = await shebangsOf(context, refreshed.repository, files);
  return ok({
    session: sessionSummaryFrom(refreshed.session),
    scope,
    baseSha,
    headSha: refreshed.session.headSha,
    files: files.map((file, index) => {
      const shebang = shebangs.get(index);
      return {
        ...diffFileViewFrom(file),
        ...(shebang !== undefined && { shebang }),
        reviewed: carried.value.states[index] ?? 'no',
      };
    }),
    reviewProgress: {
      total: carried.value.counts.total,
      reviewed: carried.value.counts.reviewed,
      changedSince: carried.value.counts.changedSince,
      unreviewed: carried.value.counts.unreviewed,
    },
    whitespace: whitespaceOf(options),
    ...forkPointViewFrom(forkPoint),
    ...pairingViewsFrom(files, commitPairs, attribution),
  });
}

/** Each extensionless file's `#!` line (ADR 0120); only highlighting needs them, so a failure is logged, not returned. */
async function shebangsOf(
  context: SessionContext,
  repository: GitRepository,
  files: readonly DiffFile[],
): Promise<ReadonlyMap<number, string>> {
  const shebangs = await readShebangs(repository, files);
  if (!shebangs.ok) {
    context.logger.warn('could not read shebang lines', { error: shebangs.error });
    return new Map();
  }
  return shebangs.value;
}

function forkPointViewFrom(forkPoint: StackForkPoint | undefined): Pick<ReviewView, 'forkPoint'> {
  if (forkPoint === undefined || forkPoint.reason === 'merge-base') {
    return {};
  }
  return {
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
      path: headPathOf(file),
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

function whitespaceOf(options: ReviewDiffOptions): ReviewView['whitespace'] {
  if (options.ignoreWhitespace === true) {
    return 'ignored';
  }
  return 'shown';
}
