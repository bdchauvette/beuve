import type { PullRequestView } from '#contract/ipc-contract.ts';
import type { StoredPullRequest } from '#internal/github/stored-pull-request.ts';

/** Stored pull request metadata as plain contract data. */
export function toPullRequestView(stored: StoredPullRequest): PullRequestView {
  const { ref } = stored;
  return {
    host: ref.host,
    owner: ref.owner,
    repo: ref.repo,
    number: ref.number,
    title: stored.title,
    body: stored.body,
    state: stored.state,
    isDraft: stored.isDraft,
    author: stored.author,
    htmlUrl: stored.htmlUrl,
    baseBranch: stored.baseBranch,
    headBranch: stored.headBranch,
    headSha: stored.headSha,
    isCrossRepository: stored.isCrossRepository,
    updatedAt: stored.updatedAt,
  };
}
