import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { execGit } from './exec-git.ts';
import type { GitRequest } from './exec-git.ts';
import type { GitError } from './git-error.ts';

/**
 * Runs git directly (never through a shell) with the hardening of {@link execGit} and returns its
 * stdout decoded as UTF-8. Never rejects.
 */
export async function runGit(request: GitRequest): Promise<Result<string, GitError>> {
  const output = await execGit(request);
  return output.ok ? ok(output.value.toString('utf8')) : output;
}
