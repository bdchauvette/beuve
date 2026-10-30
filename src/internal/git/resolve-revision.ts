import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import type { CommitSha } from './object-id.ts';
import type { GitRepository } from './open-repository.ts';
import { parseCommitSha } from './parse-commit-sha.ts';

const maxRevisionLength = 1024;

/**
 * Resolves an untrusted revision expression (branch, tag, `HEAD~2`, abbreviated sha…) to the
 * full sha of the commit it names. Anything that looks like an option is rejected before git sees
 * it, and `--end-of-options` stops git from reading it as one regardless.
 */
export async function resolveRevision(
  repository: GitRepository,
  revision: string,
): Promise<Result<CommitSha, GitError>> {
  const invalid = revisionProblem(revision);
  if (invalid !== undefined) {
    return err({ kind: 'invalid-argument', argument: revision, reason: invalid });
  }
  const args = ['rev-parse', '--verify', '--quiet', '--end-of-options', revision + '^{commit}'];
  const output = await repository.run(args);
  if (!output.ok) {
    const { error } = output;
    return error.kind === 'command-failed' && error.exitCode === 1
      ? err({ kind: 'unknown-revision', revision })
      : output;
  }
  const sha = parseCommitSha(output.value.trim());
  return sha === undefined
    ? err({ kind: 'unexpected-output', args, message: `not an object name: ${output.value}` })
    : ok(sha);
}

function revisionProblem(revision: string): string | undefined {
  if (revision.length === 0) {
    return 'revision is empty';
  }
  if (revision.length > maxRevisionLength) {
    return 'revision is too long';
  }
  if (revision.startsWith('-')) {
    return 'revision may not start with "-"';
  }
  if (hasControlCharacter(revision)) {
    return 'revision contains control characters';
  }
  return undefined;
}

function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.codePointAt(index) ?? 0;
    if (code === 0x7f || code < 0x20) {
      return true;
    }
  }
  return false;
}
