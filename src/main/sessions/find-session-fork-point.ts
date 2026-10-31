import type { GitError } from '#internal/git/git-error.ts';
import { findStackForkPoint } from '#internal/git/find-stack-fork-point.ts';
import type { StackForkPoint } from '#internal/git/find-stack-fork-point.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import type { CommitSha } from '#internal/git/object-id.ts';
import type { ReviewRange } from '#internal/git/review-range.ts';
import { err } from '#x/result/err.ts';
import type { Result } from '#x/result/result.ts';

import { rebindRepository } from './rebind-repository.ts';
import type { SessionContext } from './session-context.ts';

export interface SessionForkPointOptions {
  /** Fork points recorded by earlier checkpoints (ADR 0054). */
  readonly reviewedBases?: readonly CommitSha[];
  /** Stops this caller waiting; the shared computation stops only when nobody waits for it. */
  readonly signal?: AbortSignal | undefined;
}

/**
 * {@link findStackForkPoint} for `range`, memoized in `context.caches.forkPoints` (ADR 0081). The
 * answer depends only on the commits named, the reviewed bases and the git that merges them, all
 * in the key, so it never goes stale. Concurrent callers share one computation, which runs on a
 * handle of its own.
 */
export async function findSessionForkPoint(
  context: SessionContext,
  repository: GitRepository,
  range: ReviewRange,
  options: SessionForkPointOptions = {},
): Promise<Result<StackForkPoint, GitError>> {
  const reviewedBases = [...new Set(options.reviewedBases)].toSorted((a, b) => a.localeCompare(b));
  const key = [
    repository.root,
    repository.version.raw,
    range.base,
    range.head,
    ...reviewedBases,
  ].join('\0');
  const found = await context.caches.forkPoints.get(
    key,
    async (shared): Promise<Result<StackForkPoint, GitError>> => {
      const own = await rebindRepository(context, repository, shared);
      if (own.ok) {
        return findStackForkPoint(own.value, range, { reviewedBases });
      }
      return own;
    },
    { signal: options.signal },
  );
  if (found === 'aborted') {
    return err({ kind: 'aborted', args: ['merge-base'] });
  }
  return found;
}
