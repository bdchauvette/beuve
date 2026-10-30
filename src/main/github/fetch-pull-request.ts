import type { GithubFailureView } from '#contract/ipc-contract.ts';
import { getPullRequest } from '#internal/github/get-pull-request.ts';
import type { PullRequest, PullRequestRef } from '#internal/github/pull-request.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GithubClients } from './create-github-clients.ts';
import { failureFromGithubError } from './failure-from-github-error.ts';
import { githubFailure } from './github-failure.ts';

/** The pull request as GitHub reports it now (unconditionally), or why it couldn't be read. */
export async function fetchPullRequest(
  clients: GithubClients,
  ref: PullRequestRef,
): Promise<Result<PullRequest, GithubFailureView>> {
  const fetched = await clients.withClient(ref.host, async (client) => getPullRequest(client, ref));
  if (!fetched.ok) {
    return err(
      failureFromGithubError(fetched.error, `${ref.owner}/${ref.repo}#${String(ref.number)}`),
    );
  }
  return fetched.value.kind === 'modified'
    ? ok(fetched.value.value)
    : err(githubFailure('github-failed', 'GitHub answered 304 to an unconditional request'));
}
