import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import type { GitRepository } from './open-repository.ts';
import { parseRemoteUrls } from './parse-remote-urls.ts';
import type { RemoteUrl } from './parse-remote-urls.ts';

/**
 * The repository's remotes and their configured URLs. Read from the config rather than
 * `git remote -v`, which applies `insteadOf` rewrites: the URL the user wrote is what says which
 * GitHub repository a remote stands for. No remotes is an empty list.
 */
export async function listRemoteUrls(
  repository: GitRepository,
): Promise<Result<readonly RemoteUrl[], GitError>> {
  const output = await repository.run([
    'config',
    '--null',
    '--get-regexp',
    String.raw`^remote\..+\.url$`,
  ]);
  if (!output.ok) {
    const { error } = output;
    return error.kind === 'command-failed' && error.exitCode === 1 ? ok([]) : output;
  }
  return ok(parseRemoteUrls(output.value));
}
