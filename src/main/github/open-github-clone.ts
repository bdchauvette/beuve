import type { GithubFailureView } from '#contract/ipc-contract.ts';
import { openRepository } from '#internal/git/open-repository.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { ipcErrorFromGitError } from '../sessions/ipc-error-from-git-error.ts';

import type { RepositoryKey } from './create-clone-path-settings.ts';
import type { GithubContext } from './github-context.ts';
import { githubFailure } from './github-failure.ts';

/** The repository whose clone is wanted, where the reviewer said it is, and the request's signal. */
export interface CloneLookup {
  readonly repository: RepositoryKey;
  readonly repoPath: string | undefined;
  readonly signal: AbortSignal | undefined;
}

/**
 * The local clone to fetch into (ADR 0037): the path the reviewer gave, else the one last used
 * for the repository. beuve never clones, so without either the answer is `needs-local-clone`.
 */
export async function openGithubClone(
  context: GithubContext,
  { repository, repoPath, signal }: CloneLookup,
): Promise<Result<GitRepository, GithubFailureView>> {
  const target = repoPath ?? (await context.clonePaths.read(repository));
  const name = `${repository.owner}/${repository.repo}`;
  if (target === undefined) {
    return err(
      githubFailure(
        'needs-local-clone',
        `Enter the path of a local clone of ${name}; beuve fetches into it.`,
      ),
    );
  }
  const opened = await openRepository(target, { ...context.session.git, signal });
  if (opened.ok) {
    return ok(opened.value);
  }
  return err(
    githubFailure(
      'needs-local-clone',
      `${ipcErrorFromGitError(opened.error).message}. Enter the path of a local clone of ${name}.`,
    ),
  );
}
