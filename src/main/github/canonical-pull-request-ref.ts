import type { PullRequest, PullRequestRef } from '#internal/github/pull-request.ts';

/**
 * Where a pull request lives now: its base repository as GitHub names it (a renamed or
 * transferred repository redirects the old name), on the host it was asked for. Pure.
 */
export function canonicalPullRequestRef(
  asked: PullRequestRef,
  pullRequest: PullRequest,
): PullRequestRef {
  const repository = pullRequest.base.repository;
  return repository === undefined
    ? { ...asked, number: pullRequest.number }
    : {
        host: asked.host,
        owner: repository.owner,
        repo: repository.name,
        number: pullRequest.number,
      };
}
