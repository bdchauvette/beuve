import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';
import { hasControlCharacters } from '#x/text/has-control-characters.ts';

import type { GitError } from './git-error.ts';
import { gitRunner } from './git-runner.ts';
import type { GitRepository } from './open-repository.ts';

const maxBranchLength = 200;

/**
 * Whether `name` is a valid new branch name, as `git check-ref-format --branch` judges it, and
 * the name git would use. Refuses before asking git a name that starts with `-`, holds a control
 * character, or uses `@{…}` (which `--branch` would expand to another branch). `read`.
 */
export async function checkBranchName(
  repository: GitRepository,
  name: string,
): Promise<Result<string, GitError>> {
  const invalid = (reason: string): Result<string, GitError> => {
    return err({ kind: 'invalid-argument', argument: name, reason });
  };
  if (name === '' || name.length > maxBranchLength) {
    return invalid(`a branch name has 1 to ${String(maxBranchLength)} characters`);
  }
  if (name.startsWith('-') || name.includes('@{') || hasControlCharacters(name)) {
    return invalid('a branch name may not start with "-" or hold "@{" or control characters');
  }
  const checked = await repository[gitRunner].run(['check-ref-format', '--branch', name], {
    policy: { kind: 'read' },
  });
  if (checked.ok) {
    return ok(checked.value.trim());
  }
  if (checked.error.kind === 'command-failed') {
    return invalid('git does not accept it as a branch name');
  }
  return checked;
}
