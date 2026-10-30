import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import type { CommitSha } from './object-id.ts';
import type { GitRepository } from './open-repository.ts';

/** A file tracked at a commit: its repository-relative path and blob name. */
export interface TreeBlob {
  readonly path: string;
  readonly objectId: string;
}

const maxListingBytes = 64 * 1024 * 1024;
const entryPattern = /^blob ([0-9a-f]{40,64}) (.+)$/su;

/**
 * Every file (blob) tracked in `commit`'s tree with its object name, in git's order, so callers
 * can read many files with `readBlobs`. Submodules and symlink targets that are not blobs are
 * left out. Paths use `/` separators and are unquoted (`git ls-tree -r -z --format`).
 */
export async function listTreeBlobs(
  repository: GitRepository,
  commit: CommitSha,
): Promise<Result<readonly TreeBlob[], GitError>> {
  const output = await repository.exec(
    [
      'ls-tree',
      '-r',
      '-z',
      '--format=%(objecttype) %(objectname) %(path)',
      '--end-of-options',
      commit,
    ],
    { maxBufferBytes: maxListingBytes },
  );
  if (!output.ok) {
    return output;
  }
  const blobs: TreeBlob[] = [];
  for (const entry of output.value.toString('utf8').split('\0')) {
    const match = entryPattern.exec(entry);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      blobs.push({ objectId: match[1], path: match[2] });
    }
  }
  return ok(blobs);
}
