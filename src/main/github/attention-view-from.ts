import type { AttentionView, CiStatusView } from '#contract/ipc-contract.ts';
import { attentionFrom } from '#internal/github/attention-from.ts';
import type { PullRequestReview, ReviewRequests } from '#internal/github/pull-request-review.ts';
import type { StoredPullRequest } from '#internal/github/stored-pull-request.ts';

/** Everything the poller has read for one pull request that the attention rules need. */
export interface AttentionFacts {
  readonly viewer: string | undefined;
  readonly reviews: readonly PullRequestReview[];
  readonly requests: ReviewRequests;
  readonly ci: CiStatusView | undefined;
}

/** The pull request's attention as plain contract data, for the head the CI status is about. */
export function attentionViewFrom(stored: StoredPullRequest, facts: AttentionFacts): AttentionView {
  const attention = attentionFrom({
    viewer: facts.viewer,
    author: stored.author,
    state: stored.state,
    isDraft: stored.isDraft,
    headSha: stored.headSha,
    requests: facts.requests,
    reviews: facts.reviews,
    ci: facts.ci?.sha === stored.headSha ? facts.ci.overall : undefined,
    ...(facts.ci?.sha === stored.headSha && { failingChecks: facts.ci.counts.failure }),
  });
  return { turn: attention.turn, reasons: [...attention.reasons] };
}
