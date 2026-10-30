import { createHash } from 'node:crypto';
import path from 'node:path';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import type { CommitSha } from './object-id.ts';
import type { RepositoryPath } from './open-repository.ts';

const unsafeNameCharacters = /[^\w.-]+/gu;
const leadingDotsOrDashes = /^[.-]+/u;

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
  const name = path
    .basename(repositoryRoot)
    .replaceAll(unsafeNameCharacters, '-')
    .replace(leadingDotsOrDashes, '');
  const digest = createHash('sha256').update(repositoryRoot).digest('hex').slice(0, 12);
  const directory = name === '' ? digest : `${name}-${digest}`;
  return ok(path.join(path.resolve(root), directory, commit));
}
