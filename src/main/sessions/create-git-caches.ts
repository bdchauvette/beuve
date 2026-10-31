import type { IpcError } from '#contract/ipc-contract.ts';
import type { GitError } from '#internal/git/git-error.ts';
import type { StackForkPoint } from '#internal/git/find-stack-fork-point.ts';
import type { TreeFile } from '#internal/git/list-tree-blobs.ts';
import { ObjectReaderPool } from '#internal/git/object-reader-pool.ts';
import type { RepositoryProbe } from '#internal/git/open-repository.ts';
import { CoalescingCache } from '#x/async/coalescing-cache.ts';
import type { Logger } from '#x/log/create-logger.ts';
import type { Result } from '#x/result/result.ts';

import type { RangeDiff } from './range-diff.ts';

/**
 * A memo shared by every request: concurrent misses on one key share one computation, which is
 * aborted only when its last waiter gives up (a {@link CoalescingCache}).
 */
export interface SharedCache<V> {
  readonly get: (
    key: string,
    compute: (signal: AbortSignal | undefined) => Promise<V>,
    options?: { readonly signal?: AbortSignal | undefined },
  ) => Promise<V | 'aborted'>;
  readonly delete: (key: string) => void;
}

/**
 * The git results main shares between requests and services (ADR 0081). Every key but the
 * probe's is made of commit SHAs, which name immutable objects, so only the memory bounds evict
 * them. Ref names are never keys: each request resolves them itself.
 */
export interface GitCaches extends AsyncDisposable {
  /** `openRepository`'s probe (top level and git version) per directory, successes only. */
  readonly probes: SharedCache<Result<RepositoryProbe, GitError>>;
  /** `findStackForkPoint` per root, git version, base tip, head and reviewed bases. */
  readonly forkPoints: SharedCache<Result<StackForkPoint, GitError>>;
  /** The review diff per root, git version, range, base tip, reviewed base and variant. */
  readonly rangeDiffs: SharedCache<Result<RangeDiff, IpcError>>;
  /** Every file of a commit's tree (`listTreeBlobs`) per root and commit: chat's sandbox listing. */
  readonly treeFiles: SharedCache<Result<readonly TreeFile[], GitError>>;
  /**
   * One long-lived `cat-file --batch-command` per repository root (ADR 0087), handed to every
   * handle main opens. Disposing the caches stops them.
   */
  readonly objectReaders: ObjectReaderPool;
}

export interface GitCachesOptions {
  /**
   * `false` computes everything on every call, on the caller's own signal, as if nothing were
   * cached: for the test that compares a review with and without caching. The object readers
   * are kept either way.
   */
  readonly enabled?: boolean;
  /** For the object readers. */
  readonly logger?: Logger;
}

/** Repositories open at once in practice, with room for subdirectories and stale paths. */
const probeEntries = 64;
/** Fork points are four SHAs each; this many cover every head a session has shown. */
const forkPointEntries = 1024;
/** Review diffs: both whitespace variants of a few sessions' heads and interdiffs. */
const rangeDiffEntries = 32;
/** About four times the patch text the kept diffs hold (UTF-16, plus the parsed lines). */
const rangeDiffWeight = 256 * 1024 * 1024;
/** Tree listings: the heads chat was last asked about. */
const treeFileEntries = 8;

/** The caches of one main process. */
export function createGitCaches(options: GitCachesOptions = {}): GitCaches {
  const objectReaders = new ObjectReaderPool({
    ...(options.logger !== undefined && { logger: options.logger }),
  });
  const owned = {
    objectReaders,
    [Symbol.asyncDispose]: async (): Promise<void> => objectReaders[Symbol.asyncDispose](),
  };
  if (options.enabled === false) {
    return {
      probes: uncached(),
      forkPoints: uncached(),
      rangeDiffs: uncached(),
      treeFiles: uncached(),
      ...owned,
    };
  }
  return {
    ...owned,
    treeFiles: new CoalescingCache<string, Result<readonly TreeFile[], GitError>>({
      maxEntries: treeFileEntries,
      keep: isOk,
    }),
    probes: new CoalescingCache<string, Result<RepositoryProbe, GitError>>({
      maxEntries: probeEntries,
      keep: isOk,
    }),
    forkPoints: new CoalescingCache<string, Result<StackForkPoint, GitError>>({
      maxEntries: forkPointEntries,
      keep: isOk,
    }),
    rangeDiffs: new CoalescingCache<string, Result<RangeDiff, IpcError>>({
      maxEntries: rangeDiffEntries,
      maxWeight: rangeDiffWeight,
      weigh: rangeDiffWeightOf,
      keep: isOk,
    }),
  };
}

function uncached<V>(): SharedCache<V> {
  return {
    get: async (_key, compute, call = {}): Promise<V | 'aborted'> => compute(call.signal),
    delete: (): void => {
      // Nothing is kept.
    },
  };
}

function isOk(result: Result<unknown, unknown>): boolean {
  return result.ok;
}

function rangeDiffWeightOf(result: Result<RangeDiff, IpcError>): number {
  return result.ok ? result.value.files.reduce((sum, file) => sum + 4 * file.patch.length, 0) : 0;
}
