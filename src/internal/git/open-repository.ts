import path from 'node:path';

import type { Brand } from '#x/brand/brand.ts';
import type { Logger } from '#x/log/create-logger.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import { isVersionAtLeast } from './is-version-at-least.ts';
import { parseGitVersion } from './parse-git-version.ts';
import type { GitVersion } from './parse-git-version.ts';
import { execGit } from './exec-git.ts';
import { gitRunner } from './git-runner.ts';
import type { GitRunner, ObjectReads } from './git-runner.ts';
import { GitObjectReader } from './git-object-reader.ts';
import type { ObjectReaderPool } from './object-reader-pool.ts';
import type { ObjectContent, ObjectLookup } from './object-spec.ts';
import { streamGit } from './stream-git.ts';
import type { InterruptionPolicy } from './interruption-policy.ts';
import { runGit } from './run-git.ts';

/** The absolute top-level directory of a non-bare repository's main worktree, as git reports it. */
export type RepositoryPath = Brand<string, 'RepositoryPath'>;

/** What opening a directory asks git: where its repository is, and which git serves it. */
export interface RepositoryProbe {
  readonly root: RepositoryPath;
  readonly version: GitVersion;
}

/**
 * An opened repository: where it is and which git serves it. Its raw runner is keyed by
 * {@link gitRunner}, which only the git domain's typed operations import (ADR 0079).
 */
export interface GitRepository extends RepositoryProbe {
  readonly [gitRunner]: GitRunner;
}

export interface OpenRepositoryOptions {
  readonly gitBinary?: string;
  readonly timeout?: Temporal.Duration;
  readonly maxBufferBytes?: number;
  /**
   * Bounds opening and every command the handle runs, such as a test's signal; a call's own
   * `signal` adds to it.
   */
  readonly signal?: AbortSignal | undefined;
  readonly logger?: Logger;
  /**
   * What an earlier open of the same directory found. The handle is then bound to these options
   * without running `--version` and `--show-toplevel` again, so a caller that keeps the probe
   * gets a fresh handle, bound to its own signal, per request (ADR 0081).
   */
  readonly probe?: RepositoryProbe;
  /**
   * Where the handle's `cat-file --batch-command` comes from (ADR 0087): the pool's reader for
   * the root, shared by every handle on it. Without one, the handle starts its own reader on
   * first use, which stops as soon as it is idle.
   */
  readonly objectReaders?: ObjectReaderPool;
}

/** Oldest git with every feature used here except `merge-tree --write-tree` (`worktree list -z`). */
const minimumVersion = { major: 2, minor: 36 };

/** Runs one probe command in `cwd`. */
type ProbeRunner = (cwd: string, args: readonly string[]) => Promise<Result<string, GitError>>;

/**
 * Opens the repository containing `directory` (an absolute path) after checking that git is
 * installed and recent enough. All other operations in this domain take the returned handle.
 */
export async function openRepository(
  directory: string,
  options: OpenRepositoryOptions = {},
): Promise<Result<GitRepository, GitError>> {
  if (!path.isAbsolute(directory)) {
    return err({ kind: 'invalid-argument', argument: directory, reason: 'path must be absolute' });
  }
  const signalFor = (own: AbortSignal | undefined): AbortSignal | undefined =>
    own === undefined || options.signal === undefined || own === options.signal
      ? (own ?? options.signal)
      : AbortSignal.any([options.signal, own]);
  const runIn = async (
    cwd: string,
    args: readonly string[],
    policy: InterruptionPolicy,
    signal?: AbortSignal,
  ): Promise<Result<string, GitError>> =>
    runGit({ ...options, cwd, args, policy, signal: signalFor(signal) });

  const probed =
    options.probe === undefined
      ? await probeRepository(directory, async (cwd, args) =>
          runIn(cwd, args, { kind: 'read' }, options.signal),
        )
      : ok(options.probe);
  if (!probed.ok) {
    return probed;
  }
  const { root, version } = probed.value;
  const runner: GitRunner = {
    run: async (args, runOptions): Promise<Result<string, GitError>> =>
      runIn(root, args, runOptions.policy, runOptions.signal),
    exec: async (args, execOptions): Promise<Result<Buffer, GitError>> =>
      execGit({
        ...options,
        ...execOptions,
        cwd: root,
        args,
        signal: signalFor(execOptions.signal),
      }),
    stream: async (args, streamOptions): Promise<Result<'complete' | 'stopped', GitError>> =>
      streamGit({
        ...options,
        ...streamOptions,
        cwd: root,
        args,
        signal: signalFor(streamOptions.signal),
      }),
    objects: boundObjectReads(root, options, signalFor),
  };
  return ok({ root, version, [gitRunner]: runner });
}

/** Object reads on the pool's reader for `root` (or the handle's own), under the handle's signal. */
function boundObjectReads(
  root: string,
  options: OpenRepositoryOptions,
  signalFor: (own: AbortSignal | undefined) => AbortSignal | undefined,
): ObjectReads {
  let own: GitObjectReader | undefined;
  const reader = (): GitObjectReader => {
    const pooled = options.objectReaders?.[gitRunner](root, options.gitBinary);
    if (pooled !== undefined) {
      return pooled;
    }
    own ??= new GitObjectReader({
      root,
      idleTimeout: Temporal.Duration.from({ seconds: 0 }),
      ...(options.gitBinary !== undefined && { gitBinary: options.gitBinary }),
      ...(options.timeout !== undefined && { requestTimeout: options.timeout }),
      ...(options.logger !== undefined && { logger: options.logger }),
    });
    return own;
  };
  return {
    info: async (spec, readOptions = {}): Promise<Result<ObjectLookup, GitError>> =>
      reader().info(spec, { ...readOptions, signal: signalFor(readOptions.signal) }),
    read: async (spec, readOptions = {}): Promise<Result<ObjectContent, GitError>> =>
      reader().read(spec, { ...readOptions, signal: signalFor(readOptions.signal) }),
  };
}

async function probeRepository(
  directory: string,
  run: ProbeRunner,
): Promise<Result<RepositoryProbe, GitError>> {
  const versionOutput = await run(directory, ['--version']);
  if (!versionOutput.ok) {
    return versionOutput;
  }
  const version = parseGitVersion(versionOutput.value);
  const required = `${String(minimumVersion.major)}.${String(minimumVersion.minor)}`;
  if (
    version === undefined ||
    !isVersionAtLeast(version, minimumVersion.major, minimumVersion.minor)
  ) {
    return err({ kind: 'unsupported-git-version', found: version, required });
  }
  const topLevel = await run(directory, ['rev-parse', '--show-toplevel']);
  return topLevel.ok ? ok({ root: topLevel.value.trim() as RepositoryPath, version }) : topLevel;
}
