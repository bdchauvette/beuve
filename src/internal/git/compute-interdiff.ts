import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { diffObjects } from './diff-objects.ts';
import type { DiffObjectsOptions } from './diff-objects.ts';
import type { DiffFile } from './diff-model.ts';
import { findMergeBase } from './find-merge-base.ts';
import type { GitError } from './git-error.ts';
import type { CommitSha, TreeSha } from './object-id.ts';
import type { GitRepository } from './open-repository.ts';
import type { GitVersion } from './parse-git-version.ts';
import { replayChanges } from './replay-changes.ts';
import { replayCommits } from './replay-commits.ts';
import type { ReplayStep } from './replay-commits.ts';
import type { ReviewRange, ReviewRanges } from './review-range.ts';

/**
 * What the author changed between two revisions of a pull request.
 *
 * - `exact`: the fork point didn't move; `files` is `previous.head` → `next.head`.
 * - `rebased`: the branch moved to a new fork point. The previously reviewed changes were replayed
 *   onto the new fork point (`replayedTree`) and `files` is that tree → `next.head`, so upstream
 *   commits picked up by the rebase cancel out. `replay` says how: `range` replays the whole
 *   reviewed range in one three-way merge; `commit-pairs` replays the reviewed commits that still
 *   have a partner in the new range one by one, in the new order, and is tried only when the
 *   range replay conflicts (ADR 0054).
 * - `fallback`: no trustworthy interdiff (the replay conflicted, or git is too old); `files` is the
 *   full diff of `next`, to be reviewed in full.
 */
export type Interdiff = {
  readonly previous: ReviewRange;
  readonly next: ReviewRange;
  readonly nextMergeBase: CommitSha;
  readonly files: readonly DiffFile[];
} & (
  | { readonly kind: 'exact' }
  | {
      readonly kind: 'rebased';
      readonly previousMergeBase: CommitSha;
      readonly replayedTree: TreeSha;
      readonly replay: 'range' | 'commit-pairs';
    }
  | {
      readonly kind: 'fallback';
      readonly previousMergeBase: CommitSha;
      readonly reason: InterdiffFallbackReason;
    }
);

export type InterdiffFallbackReason =
  | { readonly kind: 'conflicts'; readonly paths: readonly string[] }
  | { readonly kind: 'git-too-old'; readonly version: GitVersion; readonly required: string };

export interface Interoptions extends DiffObjectsOptions {
  /**
   * The previously reviewed commits paired with a commit of the new range, in the new range's
   * order: replayed one by one when the whole-range replay conflicts.
   */
  readonly pairedCommits?: readonly ReplayStep[];
}

/**
 * Computes the incremental review diff from a previously reviewed range to a new one, using
 * merge-base (pull request) semantics on both sides. Conflicts and missing git features degrade
 * to a `fallback` outcome rather than an error.
 */
export async function computeInterdiff(
  repository: GitRepository,
  { previous, next }: ReviewRanges,
  options: Interoptions = {},
): Promise<Result<Interdiff, GitError>> {
  const previousMergeBase = await findMergeBase(repository, [previous.base, previous.head]);
  if (!previousMergeBase.ok) {
    return previousMergeBase;
  }
  const nextMergeBase = await findMergeBase(repository, [next.base, next.head]);
  if (!nextMergeBase.ok) {
    return nextMergeBase;
  }
  const common = { previous, next, nextMergeBase: nextMergeBase.value };

  if (previousMergeBase.value === nextMergeBase.value) {
    const files = await diffObjects(repository, { from: previous.head, to: next.head }, options);
    if (files.ok) {
      return ok({ ...common, kind: 'exact', files: files.value });
    }
    return files;
  }

  const replay = await replayChanges(repository, {
    from: previousMergeBase.value,
    to: previous.head,
    onto: nextMergeBase.value,
  });
  if (!replay.ok) {
    return replay;
  }
  const rebased = async (
    tree: TreeSha,
    method: 'range' | 'commit-pairs',
  ): Promise<Result<Interdiff, GitError>> => {
    const files = await diffObjects(repository, { from: tree, to: next.head }, options);
    if (files.ok) {
      return ok({
        ...common,
        kind: 'rebased',
        previousMergeBase: previousMergeBase.value,
        replayedTree: tree,
        replay: method,
        files: files.value,
      });
    }
    return files;
  };
  const outcome = replay.value;
  if (outcome.kind === 'clean') {
    return rebased(outcome.tree, 'range');
  }
  if (outcome.kind === 'conflicted' && (options.pairedCommits ?? []).length > 0) {
    const paired = await replayCommits(
      repository,
      nextMergeBase.value,
      options.pairedCommits ?? [],
    );
    if (!paired.ok) {
      return paired;
    }
    if (paired.value.kind === 'clean') {
      return rebased(paired.value.tree, 'commit-pairs');
    }
  }

  let reason: InterdiffFallbackReason;
  if (outcome.kind === 'conflicted') {
    reason = { kind: 'conflicts', paths: outcome.paths };
  } else {
    reason = { kind: 'git-too-old', version: outcome.version, required: outcome.required };
  }
  const files = await diffObjects(
    repository,
    { from: nextMergeBase.value, to: next.head },
    options,
  );
  if (files.ok) {
    return ok({
      ...common,
      kind: 'fallback',
      previousMergeBase: previousMergeBase.value,
      reason,
      files: files.value,
    });
  }
  return files;
}
