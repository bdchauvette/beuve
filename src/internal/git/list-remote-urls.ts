import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import { gitRunner } from './git-runner.ts';
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
  const output = await repository[gitRunner].run(
    ['config', '--null', '--get-regexp', String.raw`^remote\..+\.url$`],
    { policy: { kind: 'read' } },
  );
  if (!output.ok) {
    const { error } = output;
    if (error.kind === 'command-failed' && error.exitCode === 1) {
      return ok([]);
    }
    return output;
  }
  return ok(parseRemoteUrls(output.value));
}
