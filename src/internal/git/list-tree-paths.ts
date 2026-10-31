import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import { gitRunner } from './git-runner.ts';
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
  const output = await repository[gitRunner].exec(
    ['ls-tree', '-r', '--name-only', '-z', '--end-of-options', commit],
    { policy: { kind: 'read' }, maxBufferBytes: maxListingBytes },
  );
  if (!output.ok) {
    return output;
  }
  const text = output.value.toString('utf8');
  if (text === '') {
    return ok([]);
  }
  return ok(text.replace(trailingNul, '').split('\0'));
}
