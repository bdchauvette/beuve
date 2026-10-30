import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import type { InterruptionPolicy } from './interruption-policy.ts';

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
}
