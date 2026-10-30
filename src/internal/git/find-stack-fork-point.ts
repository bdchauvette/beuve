import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { findMergeBase } from './find-merge-base.ts';
import type { GitError } from './git-error.ts';
import { gitRunner } from './git-runner.ts';
import type { CommitSha } from './object-id.ts';
import type { GitRepository } from './open-repository.ts';
import { parseCommitSha } from './parse-commit-sha.ts';
import { replayChanges } from './replay-changes.ts';
import type { ReviewRange } from './review-range.ts';

/**
 * Where a pull request's own changes start. Usually the merge-base with the base branch, but in a
 * stack the head can still carry commits that are no longer on the base under the same SHAs:
 *
 * - `already-upstream`: the newest first-parent commit `X` of `mergeBase..head` whose whole change
 *   (`mergeBase` → `X`) is already in the base tip, i.e. merging `X` into the base is a no-op. This
 *   is a parent that was squash-merged, rebase-merged or cherry-picked under other SHAs, after the
 *   pull request was retargeted to the parent's own base.
 * - `reviewed-base`: a fork point the reviewer already signed off on (a checkpoint's base) that is
 *   still a first-parent ancestor of the head: the parent was force-pushed and this branch not yet
 *   rebased, so the old parent commits are still under it.
 * - `merge-base`: neither applies.
 *
 * The newest candidate wins. `skipped` counts first-parent commits between the merge-base and the
 * fork point.
 */
export interface StackForkPoint {
  readonly forkPoint: CommitSha;
  readonly mergeBase: CommitSha;
  readonly reason: 'merge-base' | 'already-upstream' | 'reviewed-base';
  readonly skipped: number;
}

export interface StackForkPointOptions {
  /** Fork points recorded by earlier checkpoints, any order. */
  readonly reviewedBases?: readonly CommitSha[];
  /** First-parent commits inspected. Defaults to 200. */
  readonly maxCommits?: number;
}

/**
 * Finds {@link StackForkPoint} for `range` (base tip and head). Costs a merge-base and a rev-list,
 * plus, on git 2.40 or later, one `merge-tree` for the oldest commit and a binary search over the
 * rest only when that one is already upstream (containment is assumed monotone along the chain).
 */
export async function findStackForkPoint(
  repository: GitRepository,
  range: ReviewRange,
  options: StackForkPointOptions = {},
): Promise<Result<StackForkPoint, GitError>> {
  const mergeBase = await findMergeBase(repository, range.base, range.head);
  if (!mergeBase.ok) {
    return mergeBase;
  }
  const plain: StackForkPoint = {
    forkPoint: mergeBase.value,
    mergeBase: mergeBase.value,
    reason: 'merge-base',
    skipped: 0,
  };
  const chain = await listFirstParents(repository, mergeBase.value, range.head, options);
  if (!chain.ok || chain.value.length === 0) {
    return chain.ok ? ok(plain) : chain;
  }
  const commits = chain.value;
  const reviewed = new Set(options.reviewedBases);
  const reviewedIndex = commits.findIndex((commit) => reviewed.has(commit));
  const upstreamIndex = await findNewestUpstream(repository, range.base, mergeBase.value, commits);
  if (!upstreamIndex.ok) {
    return upstreamIndex;
  }
  const candidates = [
    { index: upstreamIndex.value, reason: 'already-upstream' as const },
    { index: reviewedIndex, reason: 'reviewed-base' as const },
  ].filter((candidate) => candidate.index !== -1);
  const best = candidates.toSorted((a, b) => a.index - b.index)[0];
  const forkPoint = best === undefined ? undefined : commits[best.index];
  return best === undefined || forkPoint === undefined
    ? ok(plain)
    : ok({
        forkPoint,
        mergeBase: mergeBase.value,
        reason: best.reason,
        skipped: commits.length - best.index,
      });
}

/** Newest first. */
async function listFirstParents(
  repository: GitRepository,
  mergeBase: CommitSha,
  head: CommitSha,
  options: StackForkPointOptions,
): Promise<Result<readonly CommitSha[], GitError>> {
  const output = await repository[gitRunner].run(
    [
      'rev-list',
      '--first-parent',
      `--max-count=${String(options.maxCommits ?? 200)}`,
      '--end-of-options',
      head,
      `^${mergeBase}`,
      '--',
    ],
    { policy: { kind: 'read' } },
  );
  return output.ok
    ? ok(
        output.value
          .split('\n')
          .map((line) => parseCommitSha(line.trim()))
          .filter((sha) => sha !== undefined),
      )
    : output;
}

/** Index into `commits` (newest first) of the newest already-upstream commit, or -1. */
async function findNewestUpstream(
  repository: GitRepository,
  base: CommitSha,
  mergeBase: CommitSha,
  commits: readonly CommitSha[],
): Promise<Result<number, GitError>> {
  const baseTree = await repository[gitRunner].run(
    ['rev-parse', '--verify', '--end-of-options', base + '^{tree}'],
    { policy: { kind: 'read' } },
  );
  if (!baseTree.ok) {
    return baseTree;
  }
  const checkUpstream = async (index: number): Promise<Result<boolean, GitError>> => {
    const commit = commits[index];
    if (commit === undefined) {
      return ok(false);
    }
    const replay = await replayChanges(repository, { from: mergeBase, to: commit, onto: base });
    return replay.ok
      ? ok(replay.value.kind === 'clean' && replay.value.tree === baseTree.value.trim())
      : replay;
  };
  let known = commits.length - 1;
  const oldest = await checkUpstream(known);
  if (!oldest.ok || !oldest.value) {
    return oldest.ok ? ok(-1) : oldest;
  }
  let low = 0;
  while (low < known) {
    const middle = Math.floor((low + known) / 2);
    const probe = await checkUpstream(middle);
    if (!probe.ok) {
      return probe;
    }
    if (probe.value) {
      known = middle;
    } else {
      low = middle + 1;
    }
  }
  return ok(known);
}
