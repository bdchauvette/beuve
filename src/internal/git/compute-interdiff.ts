import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import { diffObjects } from './diff-objects.ts';
import type { DiffObjectsOptions } from './diff-objects.ts';
import type { DiffFile } from './diff-model.ts';
import { findMergeBase } from './find-merge-base.ts';
import type { GitError } from './git-error.ts';
import type { CommitSha, TreeSha } from './object-id.ts';
import type { GitRepository } from './open-repository.ts';
import type { GitVersion } from './parse-git-version.ts';
import { replayChanges } from './replay-changes.ts';
import type { ReviewRange } from './review-range.ts';

/**
 * What the author changed between two revisions of a pull request.
 *
 * - `exact`: the fork point didn't move; `files` is `previous.head` → `next.head`.
 * - `rebased`: the branch moved to a new fork point. The previously reviewed changes were replayed
 *   onto the new fork point (`replayedTree`) and `files` is that tree → `next.head`, so upstream
 *   commits picked up by the rebase cancel out.
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

/**
 * Computes the incremental review diff from a previously reviewed range to a new one, using
 * merge-base (pull request) semantics on both sides. Conflicts and missing git features degrade
 * to a `fallback` outcome rather than an error.
 */
export async function computeInterdiff(
  repository: GitRepository,
  previous: ReviewRange,
  next: ReviewRange,
  options: DiffObjectsOptions = {},
): Promise<Result<Interdiff, GitError>> {
  const previousMergeBase = await findMergeBase(repository, previous.base, previous.head);
  if (!previousMergeBase.ok) {
    return previousMergeBase;
  }
  const nextMergeBase = await findMergeBase(repository, next.base, next.head);
  if (!nextMergeBase.ok) {
    return nextMergeBase;
  }
  const common = { previous, next, nextMergeBase: nextMergeBase.value };

  if (previousMergeBase.value === nextMergeBase.value) {
    const files = await diffObjects(repository, previous.head, next.head, options);
    return files.ok ? ok({ ...common, kind: 'exact', files: files.value }) : files;
  }

  const replay = await replayChanges(repository, {
    from: previousMergeBase.value,
    to: previous.head,
    onto: nextMergeBase.value,
  });
  if (!replay.ok) {
    return replay;
  }
  const outcome = replay.value;
  if (outcome.kind === 'clean') {
    const files = await diffObjects(repository, outcome.tree, next.head, options);
    return files.ok
      ? ok({
          ...common,
          kind: 'rebased',
          previousMergeBase: previousMergeBase.value,
          replayedTree: outcome.tree,
          files: files.value,
        })
      : files;
  }

  const reason: InterdiffFallbackReason =
    outcome.kind === 'conflicted'
      ? { kind: 'conflicts', paths: outcome.paths }
      : { kind: 'git-too-old', version: outcome.version, required: outcome.required };
  const files = await diffObjects(repository, nextMergeBase.value, next.head, options);
  return files.ok
    ? ok({
        ...common,
        kind: 'fallback',
        previousMergeBase: previousMergeBase.value,
        reason,
        files: files.value,
      })
    : files;
}
