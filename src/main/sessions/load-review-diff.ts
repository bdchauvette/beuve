import type { InterdiffFallbackView, IpcError, ReviewScope } from '#contract/ipc-contract.ts';
import { computeInterdiff } from '#internal/git/compute-interdiff.ts';
import type { Interdiff } from '#internal/git/compute-interdiff.ts';
import { diffRange } from '#internal/git/diff-range.ts';
import type { DiffFile } from '#internal/git/diff-model.ts';
import { findMergeBase } from '#internal/git/find-merge-base.ts';
import type { CommitSha } from '#internal/git/object-id.ts';
import { resolveRevision } from '#internal/git/resolve-revision.ts';
import { computeReviewRange } from '#internal/session/compute-review-range.ts';
import type { ReviewRange } from '#internal/session/session.ts';
import type { LruCache } from '#pkg/datastructures/lru-cache.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

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
}

/** Display variants of the diff (ADR 0042); the default is the plain diff every service uses. */
export interface ReviewDiffOptions {
  /** `git diff --ignore-all-space`: hides whitespace-only lines; head line numbers are unchanged. */
  readonly ignoreWhitespace?: boolean;
  /** Diffs keyed by repository, commits and variant, which never change once computed. */
  readonly cache?: LruCache<string, RangeDiff>;
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
  const refreshed = await refreshSession(context, loaded.value);
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
      const mergeBase = await findMergeBase(repository, baseTip, range.headSha);
      return mergeBase.ok
        ? ok({ scope: { kind: 'up-to-date' }, baseSha: mergeBase.value, files: [] })
        : gitFailure(context.logger, mergeBase.error);
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
  const diff = await diffRange(
    refreshed.repository,
    { base: refreshed.baseTip, head: headSha },
    { ignoreWhitespace: isIgnoringWhitespace },
  );
  return diff.ok
    ? ok({ scope, baseSha: diff.value.mergeBase, files: diff.value.files })
    : gitFailure(context.logger, diff.error);
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
  const interdiff = await computeInterdiff(
    repository,
    { base: range.fromBaseSha, head: range.fromHeadSha },
    { base: baseTip, head: range.toHeadSha },
    { ignoreWhitespace: isIgnoringWhitespace },
  );
  if (!interdiff.ok) {
    return gitFailure(context.logger, interdiff.error);
  }
  return ok({
    scope: { kind: 'interdiff', ...from, outcome: toOutcome(interdiff.value) },
    baseSha: interdiff.value.nextMergeBase,
    files: interdiff.value.files,
  });
}

function toOutcome(interdiff: Interdiff): Extract<ReviewScope, { kind: 'interdiff' }>['outcome'] {
  switch (interdiff.kind) {
    case 'exact':
    case 'rebased': {
      return { kind: interdiff.kind };
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
