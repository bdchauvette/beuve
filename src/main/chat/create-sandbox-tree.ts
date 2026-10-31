import type { GitError } from '#internal/git/git-error.ts';
import { grepTree } from '#internal/git/grep-tree.ts';
import { listTreeBlobs } from '#internal/git/list-tree-blobs.ts';
import type { TreeFile } from '#internal/git/list-tree-blobs.ts';
import type { CommitSha } from '#internal/git/object-id.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import { readBlobBytes } from '#internal/git/read-blob-bytes.ts';
import type { SandboxBytes, SandboxTree } from '#internal/llm/create-read-only-sandbox.ts';
import type { Result } from '#x/result/result.ts';

import { rebindRepository } from '../sessions/rebind-repository.ts';
import type { SessionContext } from '../sessions/session-context.ts';

/** The commit a sandbox tree shows, through the request's repository handle and signal. */
export interface SandboxTreeSource {
  readonly repository: GitRepository;
  readonly commit: CommitSha;
  readonly signal?: AbortSignal;
}

/**
 * The read-only sandbox's view of `commit` (ADR 0087, TOCTOU finding 4), served from git objects
 * and never from a checkout: the listing is `ls-tree -r` once per commit (shared in
 * `context.caches.treeFiles`, since a commit's tree never changes), reads go through the
 * repository's warm `cat-file --batch-command` by object id, and `grep` is `git grep -F` on the
 * commit. `repository` is the request's handle, so the request's signal stops its reads and
 * greps; the shared listing runs on a handle of its own (ADR 0081).
 */
export function createSandboxTree(
  context: SessionContext,
  { repository, commit, signal }: SandboxTreeSource,
): SandboxTree {
  /** The value, or `undefined` (logged) when git failed: the tool call then says it failed. */
  const valueOf = <T>(result: Result<T, GitError>): T | undefined => {
    if (result.ok) {
      return result.value;
    }
    context.logger.warn('chat sandbox: git failed', { error: result.error });
    return undefined;
  };
  return {
    files: async (): Promise<readonly TreeFile[] | undefined> => {
      const listed = await context.caches.treeFiles.get(
        `${repository.root}\0${commit}`,
        async (shared): Promise<Result<readonly TreeFile[], GitError>> => {
          const own = await rebindRepository(context, repository, shared);
          if (own.ok) {
            return listTreeBlobs(own.value, commit);
          }
          return own;
        },
        { signal },
      );
      if (listed === 'aborted') {
        return undefined;
      }
      return valueOf(listed);
    },
    read: async (file, maxBytes): Promise<SandboxBytes> => {
      const read = await readBlobBytes(repository, file.objectId, { maxBytes, signal });
      const blob = valueOf(read);
      switch (blob?.kind) {
        case 'bytes': {
          return { kind: 'bytes', bytes: blob.bytes };
        }
        case 'too-large': {
          return { kind: 'too-large', size: blob.size };
        }
        default: {
          return { kind: 'unreadable' };
        }
      }
    },
    grep: async (query): ReturnType<SandboxTree['grep']> => {
      const found = await grepTree(repository, commit, { ...query, signal });
      return valueOf(found);
    },
  };
}
