import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import { gitRunner } from './git-runner.ts';
import type { CommitSha } from './object-id.ts';
import type { GitRepository } from './open-repository.ts';
import { parseLsTreeEntry } from './parse-ls-tree-entry.ts';

/** A file tracked at a commit: its repository-relative path and blob name. */
export interface TreeBlob {
  readonly path: string;
  readonly objectId: string;
}

/** A {@link TreeBlob} with its mode: `100644`, `100755` or `120000` (a symbolic link). */
export interface TreeFile extends TreeBlob {
  readonly mode: string;
}

const maxListingBytes = 64 * 1024 * 1024;

/**
 * Every file (blob) tracked in `commit`'s tree with its object name, in git's order, so callers
 * can read many files with `readBlobs`. Submodules and symlink targets that are not blobs are
 * left out. Paths use `/` separators and are never quoted (`git ls-tree -r -z`, default format;
 * see `parseLsTreeEntry`).
 */
export async function listTreeBlobs(
  repository: GitRepository,
  commit: CommitSha,
): Promise<Result<readonly TreeFile[], GitError>> {
  const output = await repository[gitRunner].exec(
    ['ls-tree', '-r', '-z', '--end-of-options', commit],
    { policy: { kind: 'read' }, maxBufferBytes: maxListingBytes },
  );
  if (!output.ok) {
    return output;
  }
  const blobs: TreeFile[] = [];
  for (const line of output.value.toString('utf8').split('\0')) {
    const entry = parseLsTreeEntry(line);
    if (entry?.type === 'blob') {
      blobs.push({ objectId: entry.objectId, path: entry.path, mode: entry.mode });
    }
  }
  return ok(blobs);
}
