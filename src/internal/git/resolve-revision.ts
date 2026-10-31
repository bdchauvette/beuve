import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import { gitRunner } from './git-runner.ts';
import type { CommitSha } from './object-id.ts';
import type { GitRepository } from './open-repository.ts';
import { parseCommitSha } from './parse-commit-sha.ts';
import { parseRevisionName } from './parse-revision-name.ts';
import type { RevisionName } from './parse-revision-name.ts';

const maxRevisionLength = 1024;

/**
 * Resolves an untrusted revision expression (branch, tag, `HEAD~2`, abbreviated sha…) to the
 * full sha of the commit it names. Anything that looks like an option is rejected before git sees
 * it, and `--end-of-options` stops git from reading it as one regardless. A {@link RevisionName}
 * is resolved on the repository's warm `cat-file --batch-command` (ADR 0087); anything else
 * (a reflog entry, a name with `{` or `:`) by a one-off `rev-parse`. Either way the ref is read
 * afresh, never cached (ADR 0081).
 */
export async function resolveRevision(
  repository: GitRepository,
  revision: string,
): Promise<Result<CommitSha, GitError>> {
  const invalid = revisionProblem(revision);
  if (invalid !== undefined) {
    return err({ kind: 'invalid-argument', argument: revision, reason: invalid });
  }
  const name = parseRevisionName(revision);
  if (name !== undefined) {
    return resolveWithReader(repository, name, revision);
  }
  const args = ['rev-parse', '--verify', '--quiet', '--end-of-options', revision + '^{commit}'];
  const output = await repository[gitRunner].run(args, { policy: { kind: 'read' } });
  if (!output.ok) {
    const { error } = output;
    if (error.kind === 'command-failed' && error.exitCode === 1) {
      return err({ kind: 'unknown-revision', revision });
    }
    return output;
  }
  const sha = parseCommitSha(output.value.trim());
  if (sha === undefined) {
    return err({ kind: 'unexpected-output', args, message: `not an object name: ${output.value}` });
  }
  return ok(sha);
}

/** `info <name>^{commit}` on the warm reader: the ref is read afresh, without a spawn. */
async function resolveWithReader(
  repository: GitRepository,
  name: RevisionName,
  revision: string,
): Promise<Result<CommitSha, GitError>> {
  const found = await repository[gitRunner].objects.info({
    kind: 'ref',
    ref: name,
    peel: 'commit',
  });
  if (!found.ok) {
    return found;
  }
  if (found.value.kind !== 'found') {
    return err({ kind: 'unknown-revision', revision });
  }
  const sha = parseCommitSha(found.value.oid);
  if (sha === undefined || found.value.type !== 'commit') {
    return err({
      kind: 'unexpected-output',
      args: ['cat-file', '--batch-command'],
      message: `not a commit: ${found.value.oid}`,
    });
  }
  return ok(sha);
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
