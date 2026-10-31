import path from 'node:path';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import type { CommitSha } from './object-id.ts';
import type { RepositoryPath } from './open-repository.ts';
import { repositoryDirectoryName } from './repository-directory-name.ts';

/**
 * Where the review worktree for `commit` of `repositoryRoot` lives under `root`:
 * `<root>/<repo-name>-<hash of repo path>/<commit>`. Deterministic, so the same commit maps to the
 * same directory across runs, and distinct repositories with the same name don't collide.
 */
export function planWorktreePath(
  root: string,
  repositoryRoot: RepositoryPath,
  commit: CommitSha,
): Result<string, GitError> {
  if (!path.isAbsolute(root)) {
    return err({
      kind: 'invalid-argument',
      argument: root,
      reason: 'worktree root must be absolute',
    });
  }
  return ok(path.join(path.resolve(root), repositoryDirectoryName(repositoryRoot), commit));
}
