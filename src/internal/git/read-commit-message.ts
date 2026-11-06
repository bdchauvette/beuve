import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import { gitRunner } from './git-runner.ts';
import type { CommitSha } from './object-id.ts';
import type { GitRepository } from './open-repository.ts';

/** A commit larger than this (its headers and message) answers `undefined`. */
const maxCommitBytes = 1024 * 1024;

export interface ReadCommitMessageOptions {
  readonly signal?: AbortSignal | undefined;
}

/**
 * The message of commit `sha` (everything after its headers), read on the repository's warm
 * `cat-file --batch-command` (ADR 0087). `undefined` when the object is missing, is not a commit
 * or is over 1 MiB.
 */
export async function readCommitMessage(
  repository: GitRepository,
  sha: CommitSha,
  options: ReadCommitMessageOptions = {},
): Promise<Result<string | undefined, GitError>> {
  const read = await repository[gitRunner].objects.read(
    { kind: 'object', oid: sha },
    { maxBytes: maxCommitBytes, signal: options.signal },
  );
  if (!read.ok) {
    return read;
  }
  if (read.value.kind !== 'content' || read.value.type !== 'commit') {
    return ok(undefined);
  }
  const text = read.value.bytes.toString('utf8');
  const end = text.indexOf('\n\n');
  if (end === -1) {
    return err({
      kind: 'unexpected-output',
      args: ['cat-file', '--batch-command'],
      message: `commit ${sha} has no message separator`,
    });
  }
  return ok(text.slice(end + 2));
}
