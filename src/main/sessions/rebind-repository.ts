import type { GitError } from '#internal/git/git-error.ts';
import { openRepository } from '#internal/git/open-repository.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import { anySignal } from '#x/async/any-signal.ts';
import type { Result } from '#x/result/result.ts';

import type { SessionContext } from './session-context.ts';

/**
 * A new handle on `repository`'s root, bound to `context.git` and `signal` only and not to the
 * request that opened `repository`: for a computation shared between requests, which runs on its
 * own signal (ADR 0081). Runs no git.
 */
export async function rebindRepository(
  context: SessionContext,
  repository: GitRepository,
  signal: AbortSignal | undefined,
): Promise<Result<GitRepository, GitError>> {
  return openRepository(repository.root, {
    ...context.git,
    signal: anySignal(context.git.signal, signal),
    probe: { root: repository.root, version: repository.version },
  });
}
