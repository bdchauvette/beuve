import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import { gitRunner } from './git-runner.ts';
import type { CommitSha } from './object-id.ts';
import type { GitRepository } from './open-repository.ts';
import type { TreeBlob } from './list-tree-blobs.ts';
import { parseLsTreeEntry } from './parse-ls-tree-entry.ts';

/**
 * The blob tracked at exactly `path` (repository-relative, `/` separators) in `commit`'s tree, or
 * `undefined` when the path is absent there or is not a file (a directory, a submodule). Pathspecs
 * are literal (`execGit`), so `path` can't match more than itself. Any path git can store is
 * found, quotes, backslashes and control characters included (`parseLsTreeEntry`).
 */
export async function findTreeBlob(
  repository: GitRepository,
  commit: CommitSha,
  path: string,
): Promise<Result<(TreeBlob & { readonly mode: string }) | undefined, GitError>> {
  const output = await repository[gitRunner].exec(
    ['ls-tree', '-z', '--end-of-options', commit, '--', path],
    { policy: { kind: 'read' } },
  );
  if (!output.ok) {
    return output;
  }
  for (const line of output.value.toString('utf8').split('\0')) {
    const entry = parseLsTreeEntry(line);
    if (entry?.type === 'blob' && entry.path === path) {
      return ok({ path, mode: entry.mode, objectId: entry.objectId });
    }
  }
  return ok(undefined);
}
