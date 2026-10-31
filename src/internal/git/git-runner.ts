import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import type { InterruptionPolicy } from './interruption-policy.ts';
import type { ObjectContent, ObjectLookup, ObjectReadOptions, ObjectSpec } from './object-spec.ts';

/**
 * The key of a {@link GitRepository}'s raw runner. Only the git domain's typed operations may
 * import it (dependency-cruiser's `git-only-through-typed-operations`), so everything else runs
 * git through an operation that declares its {@link InterruptionPolicy} (ADR 0079).
 */
export const gitRunner: unique symbol = Symbol('gitRunner');

/** Runs git in a repository's root with the hardening and limits it was opened with. */
export interface GitRunner {
  /** Runs git and decodes stdout as UTF-8. */
  readonly run: (
    args: readonly string[],
    options: GitRunOptions,
  ) => Promise<Result<string, GitError>>;
  /** Like `run`, with `input` on stdin and raw stdout, for byte-exact output such as blobs. */
  readonly exec: (
    args: readonly string[],
    options: GitExecOptions,
  ) => Promise<Result<Buffer, GitError>>;
  /**
   * Streams stdout to `onStdout` as it arrives; answering `stop` ends git with SIGTERM and the
   * call with `stopped`. For output too large to buffer, such as `git grep`. Reads only.
   */
  readonly stream: (
    args: readonly string[],
    options: GitStreamOptions,
  ) => Promise<Result<'complete' | 'stopped', GitError>>;
  /**
   * The repository's long-lived `git cat-file --batch-command` (ADR 0087), for single objects,
   * `<commit>:<path>` lookups and ref resolution without a spawn. Every request is a `read`.
   */
  readonly objects: ObjectReads;
}

/** Object lookups on a {@link GitObjectReader}, bound to the handle's own signal. */
export interface ObjectReads {
  readonly info: (
    spec: ObjectSpec,
    options?: Omit<ObjectReadOptions, 'maxBytes'>,
  ) => Promise<Result<ObjectLookup, GitError>>;
  readonly read: (
    spec: ObjectSpec,
    options?: ObjectReadOptions,
  ) => Promise<Result<ObjectContent, GitError>>;
}

export interface GitStreamOptions {
  readonly policy: { readonly kind: 'read' };
  readonly signal?: AbortSignal | undefined;
  /** Each chunk of stdout, in order. */
  readonly onStdout: (chunk: Buffer) => 'more' | 'stop';
}

export interface GitRunOptions {
  /** What an abort of `signal` (or the repository's own signal) does to this command. */
  readonly policy: InterruptionPolicy;
  /** Aborts the command as `policy` says, together with the repository's own signal. */
  readonly signal?: AbortSignal | undefined;
}

export interface GitExecOptions extends GitRunOptions {
  readonly input?: string;
  /** Overrides the repository's output cap for this call. */
  readonly maxBufferBytes?: number;
  /** Overrides the repository's timeout for this call, e.g. for a network fetch. */
  readonly timeout?: Temporal.Duration;
  /** A temporary index to use instead of the repository's (`GIT_INDEX_FILE`, ADR 0088). */
  readonly indexFile?: string;
}
