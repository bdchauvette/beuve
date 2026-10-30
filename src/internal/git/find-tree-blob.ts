import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import { gitRunner } from './git-runner.ts';
import type { CommitSha } from './object-id.ts';
import type { GitRepository } from './open-repository.ts';
import type { TreeBlob } from './list-tree-blobs.ts';

const entryPattern = /^blob (\d{6}) ([0-9a-f]{40,64}) (.+)$/su;

/**
 * The blob tracked at exactly `path` (repository-relative, `/` separators) in `commit`'s tree, or
 * `undefined` when the path is absent there or is not a file (a directory, a submodule). Pathspecs
 * are literal (`execGit`), so `path` can't match more than itself.
 */
export async function findTreeBlob(
  repository: GitRepository,
  commit: CommitSha,
  path: string,
): Promise<Result<(TreeBlob & { readonly mode: string }) | undefined, GitError>> {
  const output = await repository[gitRunner].exec(
    [
      'ls-tree',
      '-z',
      '--format=%(objecttype) %(objectmode) %(objectname) %(path)',
      '--end-of-options',
      commit,
      '--',
      path,
    ],
    { policy: { kind: 'read' } },
  );
  if (!output.ok) {
    return output;
  }
  for (const entry of output.value.toString('utf8').split('\0')) {
    const match = entryPattern.exec(entry);
    if (match?.[1] !== undefined && match[2] !== undefined && match[3] === path) {
      return ok({ path, mode: match[1], objectId: match[2] });
    }
  }
  return ok(undefined);
}
