import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import { findMergeBase } from './find-merge-base.ts';
import type { GitError } from './git-error.ts';
import type { GitRepository } from './open-repository.ts';
import { parseNumstat } from './parse-numstat.ts';
import type { ChangedFile } from './parse-numstat.ts';
import type { ReviewRange } from './review-range.ts';

/**
 * The files a pull request touches (merge-base of `base` and `head` to `head`) with added and
 * removed line counts: cheaper than a full diff, for trees and summaries.
 */
export async function listChangedFiles(
  repository: GitRepository,
  range: ReviewRange,
): Promise<Result<readonly ChangedFile[], GitError>> {
  const mergeBase = await findMergeBase(repository, range.base, range.head);
  if (!mergeBase.ok) {
    return mergeBase;
  }
  const args = [
    'diff',
    '--numstat',
    '-z',
    '--find-renames',
    '--no-ext-diff',
    '--no-textconv',
    '--end-of-options',
    mergeBase.value,
    range.head,
  ];
  const output = await repository.run(args);
  if (!output.ok) {
    return output;
  }
  const files = parseNumstat(output.value);
  return files === undefined
    ? err({ kind: 'unexpected-output', args, message: 'malformed --numstat output' })
    : ok(files);
}
