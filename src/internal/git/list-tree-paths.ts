import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import type { GitError } from './git-error.ts';
import type { CommitSha } from './object-id.ts';
import type { GitRepository } from './open-repository.ts';

/** Generous enough for a tree of a few hundred thousand paths. */
const maxListingBytes = 64 * 1024 * 1024;
const trailingNul = /\0$/u;

/**
 * Every path tracked in `commit`'s tree, files and submodules alike, in git's order
 * (`git ls-tree -r --name-only -z`). Paths are repository-relative with `/` separators, unquoted.
 */
export async function listTreePaths(
  repository: GitRepository,
  commit: CommitSha,
): Promise<Result<readonly string[], GitError>> {
  const output = await repository.exec(
    ['ls-tree', '-r', '--name-only', '-z', '--end-of-options', commit],
    { maxBufferBytes: maxListingBytes },
  );
  if (!output.ok) {
    return output;
  }
  const text = output.value.toString('utf8');
  return ok(text === '' ? [] : text.replace(trailingNul, '').split('\0'));
}
