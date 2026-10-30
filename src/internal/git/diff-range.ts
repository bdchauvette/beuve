import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { diffObjects } from './diff-objects.ts';
import type { DiffObjectsOptions } from './diff-objects.ts';
import type { DiffFile } from './diff-model.ts';
import { findMergeBase } from './find-merge-base.ts';
import type { GitError } from './git-error.ts';
import type { CommitSha } from './object-id.ts';
import type { GitRepository } from './open-repository.ts';
import type { ReviewRange } from './review-range.ts';

export interface RangeDiff {
  readonly range: ReviewRange;
  /** Where `head` forked from `base`; the diff's left side. */
  readonly mergeBase: CommitSha;
  readonly files: readonly DiffFile[];
}

/**
 * The diff a pull request shows (`base...head`): from the merge-base of `base` and `head` to
 * `head`, so commits that landed on `base` after the fork don't appear.
 */
export async function diffRange(
  repository: GitRepository,
  range: ReviewRange,
  options: DiffObjectsOptions = {},
): Promise<Result<RangeDiff, GitError>> {
  const mergeBase = await findMergeBase(repository, range.base, range.head);
  if (!mergeBase.ok) {
    return mergeBase;
  }
  const files = await diffObjects(repository, mergeBase.value, range.head, options);
  return files.ok ? ok({ range, mergeBase: mergeBase.value, files: files.value }) : files;
}
