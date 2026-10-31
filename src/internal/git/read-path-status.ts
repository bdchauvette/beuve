import path from 'node:path';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import { gitRunner } from './git-runner.ts';
import type { GitRepository } from './open-repository.ts';

/** Whether a tracked file in the main working tree matches `HEAD`. */
export type PathStatus = 'clean' | 'modified';

/**
 * Whether the tracked file at `relativePath` (repository-relative) differs, staged or not, from
 * `HEAD` in the main working tree. An untracked file is `clean`. A read: optional locks are off,
 * so git doesn't refresh the index.
 */
export async function readPathStatus(
  repository: GitRepository,
  relativePath: string,
): Promise<Result<PathStatus, GitError>> {
  if (relativePath === '' || path.isAbsolute(relativePath)) {
    return err({
      kind: 'invalid-argument',
      argument: relativePath,
      reason: 'expected a repository-relative path',
    });
  }
  const status = await repository[gitRunner].run(
    ['status', '--porcelain', '--untracked-files=no', '--', relativePath],
    { policy: { kind: 'read' } },
  );
  if (status.ok) {
    if (status.value.trim() === '') {
      return ok('clean');
    }
    return ok('modified');
  }
  return status;
}
