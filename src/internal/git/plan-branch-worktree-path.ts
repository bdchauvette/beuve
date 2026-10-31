import { createHash } from 'node:crypto';
import path from 'node:path';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import type { RepositoryPath } from './open-repository.ts';
import { repositoryDirectoryName } from './repository-directory-name.ts';

const unsafeSlugCharacters = /[^\w.-]+/gu;
const edgeDotsOrDashes = /^[.-]+|[.-]+$/gu;

/** Where a branch worktree goes: the root that holds them, the repository, and the branch. */
export interface BranchWorktreePlace {
  readonly root: string;
  readonly repositoryRoot: RepositoryPath;
  readonly branch: string;
}

/**
 * Where the worktree of `branch` of `repositoryRoot` lives under `root`:
 * `<root>/<repo-name>-<hash of repo path>/<branch slug>-<hash of branch>`, so `review/pr-12` and
 * `review-pr/12` never share a directory, and the editor's window title still reads `pr-12`.
 */
export function planBranchWorktreePath({
  root,
  repositoryRoot,
  branch,
}: BranchWorktreePlace): Result<string, GitError> {
  if (!path.isAbsolute(root)) {
    return err({
      kind: 'invalid-argument',
      argument: root,
      reason: 'worktree root must be absolute',
    });
  }
  const slug = branch.replaceAll(unsafeSlugCharacters, '-').replaceAll(edgeDotsOrDashes, '');
  const digest = createHash('sha256').update(branch).digest('hex').slice(0, 8);
  const name = [slug, digest].filter((part) => part !== '').join('-');
  return ok(path.join(path.resolve(root), repositoryDirectoryName(repositoryRoot), name));
}
