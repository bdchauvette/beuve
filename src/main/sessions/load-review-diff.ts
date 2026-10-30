import type { InterdiffFallbackView, IpcError, ReviewScope } from '#contract/ipc-contract.ts';
import { attributeHunks } from '#internal/git/attribute-hunks.ts';
import type { FileAttribution } from '#internal/git/attribute-hunks.ts';
import { computeCommitPairs } from '#internal/git/compute-commit-pairs.ts';
import type { CommitPairs } from '#internal/git/compute-commit-pairs.ts';
import { computeInterdiff } from '#internal/git/compute-interdiff.ts';
import type { Interdiff } from '#internal/git/compute-interdiff.ts';
import { diffObjects } from '#internal/git/diff-objects.ts';
import type { DiffFile } from '#internal/git/diff-model.ts';
import { findStackForkPoint } from '#internal/git/find-stack-fork-point.ts';
import type { StackForkPoint } from '#internal/git/find-stack-fork-point.ts';
import type { CommitSha } from '#internal/git/object-id.ts';
import { resolveRevision } from '#internal/git/resolve-revision.ts';
import { computeReviewRange } from '#internal/session/compute-review-range.ts';
import type { ReviewRange } from '#internal/session/session.ts';
import type { LruCache } from '#x/collections/lru-cache.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { gitFailure } from './git-failure.ts';
import { loadSession } from './load-session.ts';
import { refreshSession } from './refresh-session.ts';
import type { RefreshedSession } from './refresh-session.ts';
import type { SessionContext } from './session-context.ts';

/** A computed review diff without the session behind it, as {@link ReviewDiffOptions} caches it. */
export interface RangeDiff {
  readonly scope: ReviewScope;
  readonly baseSha: CommitSha;
  readonly files: readonly DiffFile[];
  /** Where the change starts, when that isn't the merge-base (a stacked parent, ADR 0054). */
  readonly forkPoint?: StackForkPoint;
  /** For an interdiff whose ranges were short enough to pair (ADR 0054). */
  readonly commitPairs?: CommitPairs;
  /** Aligned with `files`, when `commitPairs` is set. */
  readonly attribution?: readonly FileAttribution[];
}

/** Display variants of the diff (ADR 0042); the default is the plain diff every service uses. */
export interface ReviewDiffOptions {
  /** `git diff --ignore-all-space`: hides whitespace-only lines; head line numbers are unchanged. */
  readonly ignoreWhitespace?: boolean;
  /** Diffs keyed by repository, commits and variant, which never change once computed. */
  readonly cache?: LruCache<string, RangeDiff>;
  /** Diff at this head, which the caller checked, instead of reading the head again (ADR 0078). */
  readonly headSha?: CommitSha;
  /** Diff from this base tip, which the caller resolved, instead of reading the base again. */
  readonly baseTip?: CommitSha;
}

/** The diff a review shows, still in git-domain types, with the refreshed session behind it. */
export interface ReviewDiff extends RangeDiff {
  readonly refreshed: RefreshedSession;
}

/**
 * What the reviewer should look at now: refreshes the head from git, asks the session domain
 * which range still needs review, and has the git domain diff it (full range, or a rebase-aware
 * interdiff from the last checkpoint). Main translates between the two domains here.
 */
export async function loadReviewDiff(
  context: SessionContext,
  sessionId: string,
  options: ReviewDiffOptions = {},
): Promise<Result<ReviewDiff, IpcError>> {
  const loaded = loadSession(context, sessionId);
  if (!loaded.ok) {
    return loaded;
  }
  const refreshed = await refreshSession(context, loaded.value, {
    ...(options.headSha !== undefined && { headSha: options.headSha }),
    ...(options.baseTip !== undefined && { baseTip: options.baseTip }),
  });
  if (!refreshed.ok) {
    return refreshed;
  }
  const range = computeReviewRange(refreshed.value.session);
  const diff = await cachedRangeDiff(context, refreshed.value, range, options);
  return diff.ok ? ok({ ...diff.value, refreshed: refreshed.value }) : diff;
}

async function cachedRangeDiff(
  context: SessionContext,
  refreshed: RefreshedSession,
  range: ReviewRange,
  options: ReviewDiffOptions,
): Promise<Result<RangeDiff, IpcError>> {
  const isIgnoringWhitespace = options.ignoreWhitespace === true;
  const key = [
    refreshed.repository.root,
    refreshed.baseTip,
    range.kind,
    range.kind === 'interdiff' ? `${range.fromBaseSha}:${range.fromHeadSha}` : '',
    refreshed.session.review.kind === 'reviewed' ? refreshed.session.review.checkpoint.baseSha : '',
    range.kind === 'interdiff' ? range.toHeadSha : range.headSha,
    isIgnoringWhitespace ? 'w' : '',
  ].join('\0');
  const cached = options.cache?.get(key);
  if (cached !== undefined) {
    return ok(cached);
  }
  const diff = await diffReviewRange(context, refreshed, range, isIgnoringWhitespace);
  if (diff.ok) {
    options.cache?.set(key, diff.value);
  }
  return diff;
}

async function diffReviewRange(
  context: SessionContext,
  refreshed: RefreshedSession,
  range: ReviewRange,
  isIgnoringWhitespace: boolean,
): Promise<Result<RangeDiff, IpcError>> {
  const { repository, baseTip } = refreshed;
  switch (range.kind) {
    case 'full': {
      return diffFull(context, refreshed, range.headSha, { kind: 'full' }, isIgnoringWhitespace);
    }
    case 'up-to-date': {
      const { review } = refreshed.session;
      const fork = await findStackForkPoint(
        repository,
        { base: baseTip, head: range.headSha },
        { reviewedBases: review.kind === 'reviewed' ? [review.checkpoint.baseSha] : [] },
      );
      return fork.ok
        ? ok({
            scope: { kind: 'up-to-date' },
            baseSha: fork.value.forkPoint,
            files: [],
            ...stackForkPoint(fork.value),
          })
        : gitFailure(context.logger, fork.error);
    }
    case 'interdiff': {
      return diffInterdiff(context, refreshed, range, isIgnoringWhitespace);
    }
  }
}

async function diffFull(
  context: SessionContext,
  refreshed: RefreshedSession,
  headSha: CommitSha,
  scope: ReviewScope,
  isIgnoringWhitespace: boolean,
): Promise<Result<RangeDiff, IpcError>> {
  const { repository } = refreshed;
  const fork = await findStackForkPoint(repository, { base: refreshed.baseTip, head: headSha });
  if (!fork.ok) {
    return gitFailure(context.logger, fork.error);
  }
  const files = await diffObjects(repository, fork.value.forkPoint, headSha, {
    ignoreWhitespace: isIgnoringWhitespace,
  });
  return files.ok
    ? ok({
        scope,
        baseSha: fork.value.forkPoint,
        files: files.value,
        ...stackForkPoint(fork.value),
      })
    : gitFailure(context.logger, files.error);
}

async function diffInterdiff(
  context: SessionContext,
  refreshed: RefreshedSession,
  range: Extract<ReviewRange, { kind: 'interdiff' }>,
  isIgnoringWhitespace: boolean,
): Promise<Result<RangeDiff, IpcError>> {
  const { repository, baseTip } = refreshed;
  const from = { fromBaseSha: range.fromBaseSha, fromHeadSha: range.fromHeadSha };
  const present = await Promise.all([
    resolveRevision(repository, range.fromBaseSha),
    resolveRevision(repository, range.fromHeadSha),
  ]);
  const missing = present.find((resolved) => !resolved.ok);
  if (missing !== undefined) {
    if (missing.error.kind !== 'unknown-revision') {
      return gitFailure(context.logger, missing.error);
    }
    return diffFull(
      context,
      refreshed,
      range.toHeadSha,
      {
        kind: 'interdiff',
        ...from,
        outcome: { kind: 'fallback', reason: { kind: 'reviewed-commits-missing' } },
      },
      isIgnoringWhitespace,
    );
  }
  const fork = await findStackForkPoint(
    repository,
    { base: baseTip, head: range.toHeadSha },
    { reviewedBases: [range.fromBaseSha] },
  );
  if (!fork.ok) {
    return gitFailure(context.logger, fork.error);
  }
  const previous = { base: range.fromBaseSha, head: range.fromHeadSha };
  const next = { base: fork.value.forkPoint, head: range.toHeadSha };
  const pairs = await computeCommitPairs(repository, previous, next, {
    ignoreWhitespace: isIgnoringWhitespace,
  });
  if (!pairs.ok) {
    return gitFailure(context.logger, pairs.error);
  }
  const usablePairs = pairs.value.truncated ? undefined : pairs.value;
  const interdiff = await computeInterdiff(repository, previous, next, {
    ignoreWhitespace: isIgnoringWhitespace,
    pairedCommits: (usablePairs?.pairs ?? [])
      .filter((pair) => pair.kind === 'unchanged' || pair.kind === 'modified')
      .map((pair) => ({ parent: pair.previous.parent, commit: pair.previous.sha })),
  });
  if (!interdiff.ok) {
    return gitFailure(context.logger, interdiff.error);
  }
  const { files } = interdiff.value;
  return ok({
    scope: { kind: 'interdiff', ...from, outcome: outcomeFrom(interdiff.value) },
    baseSha: interdiff.value.nextMergeBase,
    files,
    ...stackForkPoint(fork.value),
    ...(usablePairs !== undefined && {
      commitPairs: usablePairs,
      attribution: attributeHunks(files, usablePairs.nextCommits),
    }),
  });
}

function stackForkPoint(fork: StackForkPoint): { readonly forkPoint?: StackForkPoint } {
  return fork.reason === 'merge-base' ? {} : { forkPoint: fork };
}

function outcomeFrom(interdiff: Interdiff): Extract<ReviewScope, { kind: 'interdiff' }>['outcome'] {
  switch (interdiff.kind) {
    case 'exact': {
      return { kind: 'exact' };
    }
    case 'rebased': {
      return interdiff.replay === 'commit-pairs'
        ? { kind: 'rebased', replay: 'commit-pairs' }
        : { kind: 'rebased' };
    }
    case 'fallback': {
      const { reason } = interdiff;
      const view: InterdiffFallbackView =
        reason.kind === 'conflicts'
          ? { kind: 'conflicts', paths: [...reason.paths] }
          : { kind: 'git-too-old', version: reason.version.raw, required: reason.required };
      return { kind: 'fallback', reason: view };
    }
  }
}
