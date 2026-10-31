import type { InterdiffFallbackView, IpcError, ReviewScope } from '#contract/ipc-contract.ts';
import { attributeHunks } from '#internal/git/attribute-hunks.ts';
import { computeCommitPairs } from '#internal/git/compute-commit-pairs.ts';
import type { CommitPairs } from '#internal/git/compute-commit-pairs.ts';
import { computeInterdiff } from '#internal/git/compute-interdiff.ts';
import type { Interdiff } from '#internal/git/compute-interdiff.ts';
import { diffObjects } from '#internal/git/diff-objects.ts';
import type { GitError } from '#internal/git/git-error.ts';
import type { StackForkPoint } from '#internal/git/find-stack-fork-point.ts';
import type { CommitSha } from '#internal/git/object-id.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import { resolveRevision } from '#internal/git/resolve-revision.ts';
import { computeReviewRange } from '#internal/session/compute-review-range.ts';
import type { ReviewRange } from '#internal/session/session.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { findSessionForkPoint } from './find-session-fork-point.ts';
import { gitFailure } from './git-failure.ts';
import { ipcErrorFromGitError } from './ipc-error-from-git-error.ts';
import { loadSession } from './load-session.ts';
import type { RangeDiff } from './range-diff.ts';
import { reviewedBasesOf } from './reviewed-bases-of.ts';
import { rebindRepository } from './rebind-repository.ts';
import { refreshSession } from './refresh-session.ts';
import type { RefreshedSession } from './refresh-session.ts';
import type { SessionContext } from './session-context.ts';

/** Display variants of the diff (ADR 0042); the default is the plain diff every service uses. */
export interface ReviewDiffOptions {
  /** `git diff --ignore-all-space`: hides whitespace-only lines; head line numbers are unchanged. */
  readonly ignoreWhitespace?: boolean;
  /** Diff at this head, which the caller checked, instead of reading the head again (ADR 0078). */
  readonly headSha?: CommitSha;
  /** Diff from this base tip, which the caller resolved, instead of reading the base again. */
  readonly baseTip?: CommitSha;
  /**
   * Aborts this request's git commands (ADR 0079). The diff itself is shared with every other
   * request for the same commits, so it stops only when no request waits for it (ADR 0081).
   */
  readonly signal?: AbortSignal | undefined;
}

/** The diff a review shows, still in git-domain types, with the refreshed session behind it. */
export interface ReviewDiff extends RangeDiff {
  readonly refreshed: RefreshedSession;
}

/**
 * What the reviewer should look at now: refreshes the head from git, asks the session domain
 * which range still needs review, and has the git domain diff it (full range, or a rebase-aware
 * interdiff from the last checkpoint). Main translates between the two domains here. The refs
 * are read for every call; the diff for the commits they name comes from `context.caches`.
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
    signal: options.signal,
  });
  if (!refreshed.ok) {
    return refreshed;
  }
  const range = computeReviewRange(refreshed.value.session);
  const diff = await sharedRangeDiff(context, { refreshed: refreshed.value, range }, options);
  if (diff.ok) {
    return ok({ ...diff.value, refreshed: refreshed.value });
  }
  return diff;
}

/**
 * The diff for `range`, from `context.caches.rangeDiffs`. The key holds everything the diff is a
 * function of: the repository, the git that computes it, the base tip, the range's commits, the
 * reviewed base the stack-aware fork point may use, and the variant. All but the root are SHAs or
 * fixed values, so a kept diff is never stale. The computation runs on its own handle and signal,
 * so one request giving up doesn't stop it for another.
 */
async function sharedRangeDiff(
  context: SessionContext,
  { refreshed, range }: RangeOfSession,
  options: ReviewDiffOptions,
): Promise<Result<RangeDiff, IpcError>> {
  const isIgnoringWhitespace = options.ignoreWhitespace === true;
  const { repository } = refreshed;
  const key = rangeDiffKey({ refreshed, range }, isIgnoringWhitespace);
  const diff = await context.caches.rangeDiffs.get(
    key,
    async (shared): Promise<Result<RangeDiff, IpcError>> => {
      const own = await rebindRepository(context, repository, shared);
      if (!own.ok) {
        return gitFailure(context.logger, own.error);
      }
      const computing: Computing = { context, refreshed, repository: own.value, signal: shared };
      return diffReviewRange(computing, range, isIgnoringWhitespace);
    },
    { signal: options.signal },
  );
  if (diff === 'aborted') {
    return err(ipcErrorFromGitError({ kind: 'aborted', args: ['diff'] }));
  }
  return diff;
}

/** The key of a range's diff: every value it is a function of. */
function rangeDiffKey({ refreshed, range }: RangeOfSession, isIgnoringWhitespace: boolean): string {
  const { repository, session } = refreshed;
  let interdiffFrom = '';
  let head: string;
  if (range.kind === 'interdiff') {
    interdiffFrom = `${range.fromBaseSha}:${range.fromHeadSha}`;
    head = range.toHeadSha;
  } else {
    head = range.headSha;
  }
  let variant = '';
  if (isIgnoringWhitespace) {
    variant = 'w';
  }
  return [
    repository.root,
    repository.version.raw,
    refreshed.baseTip,
    range.kind,
    interdiffFrom,
    reviewedBasesOf(session.review)[0] ?? '',
    head,
    variant,
  ].join('\0');
}

/** A review range, and the refreshed session it is a range of. */
interface RangeOfSession {
  readonly refreshed: RefreshedSession;
  readonly range: ReviewRange;
}

/** The head a full diff runs to, and the scope to report it under. */
interface FullDiff {
  readonly headSha: CommitSha;
  readonly scope: ReviewScope;
}

/** One shared diff computation: its own handle and signal, and the refresh it diffs for. */
interface Computing {
  readonly context: SessionContext;
  readonly refreshed: RefreshedSession;
  readonly repository: GitRepository;
  readonly signal: AbortSignal | undefined;
}

async function diffReviewRange(
  computing: Computing,
  range: ReviewRange,
  isIgnoringWhitespace: boolean,
): Promise<Result<RangeDiff, IpcError>> {
  const { context, refreshed } = computing;
  switch (range.kind) {
    case 'full': {
      return diffFull(
        computing,
        { headSha: range.headSha, scope: { kind: 'full' } },
        isIgnoringWhitespace,
      );
    }
    case 'up-to-date': {
      const { review } = refreshed.session;
      const fork = await forkPointOf(computing, range.headSha, reviewedBasesOf(review));
      if (fork.ok) {
        return ok({
          scope: { kind: 'up-to-date' },
          baseSha: fork.value.forkPoint,
          files: [],
          ...stackForkPoint(fork.value),
        });
      }
      return gitFailure(context.logger, fork.error);
    }
    case 'interdiff': {
      return diffInterdiff(computing, range, isIgnoringWhitespace);
    }
  }
}

async function forkPointOf(
  computing: Computing,
  head: CommitSha,
  reviewedBases: readonly CommitSha[],
): Promise<Result<StackForkPoint, GitError>> {
  return findSessionForkPoint(
    computing.context,
    { repository: computing.repository, range: { base: computing.refreshed.baseTip, head } },
    { reviewedBases, signal: computing.signal },
  );
}

async function diffFull(
  computing: Computing,
  { headSha, scope }: FullDiff,
  isIgnoringWhitespace: boolean,
): Promise<Result<RangeDiff, IpcError>> {
  const { context, repository } = computing;
  const fork = await forkPointOf(computing, headSha, []);
  if (!fork.ok) {
    return gitFailure(context.logger, fork.error);
  }
  const files = await diffObjects(
    repository,
    { from: fork.value.forkPoint, to: headSha },
    {
      ignoreWhitespace: isIgnoringWhitespace,
    },
  );
  if (files.ok) {
    return ok({
      scope,
      baseSha: fork.value.forkPoint,
      files: files.value,
      ...stackForkPoint(fork.value),
    });
  }
  return gitFailure(context.logger, files.error);
}

async function diffInterdiff(
  computing: Computing,
  range: Extract<ReviewRange, { kind: 'interdiff' }>,
  isIgnoringWhitespace: boolean,
): Promise<Result<RangeDiff, IpcError>> {
  const { context, repository } = computing;
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
      computing,
      {
        headSha: range.toHeadSha,
        scope: {
          kind: 'interdiff',
          ...from,
          outcome: { kind: 'fallback', reason: { kind: 'reviewed-commits-missing' } },
        },
      },
      isIgnoringWhitespace,
    );
  }
  const fork = await forkPointOf(computing, range.toHeadSha, [range.fromBaseSha]);
  if (!fork.ok) {
    return gitFailure(context.logger, fork.error);
  }
  const previous = { base: range.fromBaseSha, head: range.fromHeadSha };
  const next = { base: fork.value.forkPoint, head: range.toHeadSha };
  const pairs = await computeCommitPairs(
    repository,
    { previous, next },
    {
      ignoreWhitespace: isIgnoringWhitespace,
    },
  );
  if (!pairs.ok) {
    return gitFailure(context.logger, pairs.error);
  }
  let usablePairs: CommitPairs | undefined;
  if (!pairs.value.truncated) {
    usablePairs = pairs.value;
  }
  const interdiff = await computeInterdiff(
    repository,
    { previous, next },
    {
      ignoreWhitespace: isIgnoringWhitespace,
      pairedCommits: (usablePairs?.pairs ?? [])
        .filter((pair) => pair.kind === 'unchanged' || pair.kind === 'modified')
        .map((pair) => {
          return { parent: pair.previous.parent, commit: pair.previous.sha };
        }),
    },
  );
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

function stackForkPoint(fork: StackForkPoint): Pick<RangeDiff, 'forkPoint'> {
  if (fork.reason === 'merge-base') {
    return {};
  }
  return { forkPoint: fork };
}

function outcomeFrom(interdiff: Interdiff): Extract<ReviewScope, { kind: 'interdiff' }>['outcome'] {
  switch (interdiff.kind) {
    case 'exact': {
      return { kind: 'exact' };
    }
    case 'rebased': {
      if (interdiff.replay === 'commit-pairs') {
        return { kind: 'rebased', replay: 'commit-pairs' };
      }
      return { kind: 'rebased' };
    }
    case 'fallback': {
      const { reason } = interdiff;
      if (reason.kind === 'conflicts') {
        return { kind: 'fallback', reason: { kind: 'conflicts', paths: [...reason.paths] } };
      }
      const view: InterdiffFallbackView = {
        kind: 'git-too-old',
        version: reason.version.raw,
        required: reason.required,
      };
      return { kind: 'fallback', reason: view };
    }
  }
}
