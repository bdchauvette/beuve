import path from 'node:path';

import type { Brand } from '#pkg/brand/brand.ts';
import type { Logger } from '#pkg/logger/create-logger.ts';
import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import type { GitError } from './git-error.ts';
import { isVersionAtLeast } from './is-version-at-least.ts';
import { parseGitVersion } from './parse-git-version.ts';
import type { GitVersion } from './parse-git-version.ts';
import { execGit } from './exec-git.ts';
import { runGit } from './run-git.ts';

/** The absolute top-level directory of a non-bare repository's main worktree, as git reports it. */
export type RepositoryPath = Brand<string, 'RepositoryPath'>;

/** An opened repository: where it is, which git serves it, and a runner bound to it. */
export interface GitRepository {
  readonly root: RepositoryPath;
  readonly version: GitVersion;
  /** Runs git in `root` with the hardening and limits this repository was opened with. */
  readonly run: (args: readonly string[]) => Promise<Result<string, GitError>>;
  /** Like `run`, with `input` on stdin and raw stdout, for byte-exact output such as blobs. */
  readonly exec: (
    args: readonly string[],
    options: GitExecOptions,
  ) => Promise<Result<Buffer, GitError>>;
}

export interface GitExecOptions {
  readonly input?: string;
  /** Overrides the repository's output cap for this call. */
  readonly maxBufferBytes?: number;
  /** Overrides the repository's timeout for this call, e.g. for a network fetch. */
  readonly timeoutMs?: number;
}

export interface OpenRepositoryOptions {
  readonly gitBinary?: string;
  readonly timeoutMs?: number;
  readonly maxBufferBytes?: number;
  readonly logger?: Logger;
}

/** Oldest git with every feature used here except `merge-tree --write-tree` (`worktree list -z`). */
const minimumVersion = { major: 2, minor: 36 };

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
  const runIn = async (cwd: string, args: readonly string[]): Promise<Result<string, GitError>> =>
    runGit({ ...options, cwd, args });

  const versionOutput = await runIn(directory, ['--version']);
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

  const topLevel = await runIn(directory, ['rev-parse', '--show-toplevel']);
  if (!topLevel.ok) {
    return topLevel;
  }
  const root = topLevel.value.trim() as RepositoryPath;
  return ok({
    root,
    version,
    run: async (args): Promise<Result<string, GitError>> => runIn(root, args),
    exec: async (args, execOptions): Promise<Result<Buffer, GitError>> =>
      execGit({ ...options, ...execOptions, cwd: root, args }),
  });
}
