import type { Attention } from './attention.ts';
import type { PullRequestReview, ReviewRequests } from './pull-request-review.ts';

/** What the attention rules read; all of it comes from data the poller already fetches. */
export interface AttentionInput {
  /** The signed-in user's login, when known. */
  readonly viewer: string | undefined;
  readonly author: string;
  readonly state: 'open' | 'closed' | 'merged';
  readonly isDraft: boolean;
  readonly headSha: string;
  readonly requests: ReviewRequests;
  /** Submitted reviews, oldest first. */
  readonly reviews: readonly PullRequestReview[];
  /** The head's CI rollup, when it has been fetched. */
  readonly ci: 'pending' | 'success' | 'failure' | 'neutral' | 'none' | undefined;
  /** How many of the head's checks fail, for the reason. */
  readonly failingChecks?: number;
}

/**
 * Derives whose turn a pull request is, Critique/Gerrit style (ADR 0066). In order:
 *
 * 1. Closed or merged: nobody's (`unknown`).
 * 2. The author's: a draft; a reviewer's latest decision is "changes requested" on the current
 *    head (the author has not pushed since); CI failing on the head.
 * 3. The reviewers': someone was asked to review (a request, including a re-request after a push),
 *    or a reviewer who requested changes has a head the author pushed to since. It is `you`
 *    when the viewer is one of those reviewers.
 * 4. Otherwise `unknown`, or the author's when the head is approved with CI passing (ready to
 *    merge).
 *
 * The author's turn reads `you` when the viewer is the author. A comment-only review changes
 * nobody's turn; a dismissed review no longer counts. Unresolved review threads need GraphQL and
 * are not read. Pure.
 */
export function attentionFrom(input: AttentionInput): Attention {
  if (input.state !== 'open') {
    return { turn: 'unknown', reasons: [`the pull request is ${input.state}`] };
  }
  const decisions = latestDecisions(input);
  const blocking = decisions.filter((review) => {
    return review.verdict === 'changes-requested' && review.commitSha === input.headSha;
  });
  const stale = decisions.filter((review) => {
    return review.verdict === 'changes-requested' && review.commitSha !== input.headSha;
  });
  const authorReasons = [
    ...(input.isDraft ? ['it is a draft'] : []),
    ...blocking.map((review) => `${review.reviewer} requested changes`),
    ...(input.ci === 'failure' ? [failingReason(input.failingChecks)] : []),
  ];
  const reviewerLogins = [
    ...input.requests.users,
    ...stale.map((review) => review.reviewer),
  ].filter((login, index, all) => all.indexOf(login) === index && login !== input.author);
  const reviewerReasons = [
    ...input.requests.users.map((login) => `a review was requested from ${login}`),
    ...input.requests.teams.map((slug) => `a review was requested from team ${slug}`),
    ...stale.map((review) => `the author pushed since ${review.reviewer} requested changes`),
  ];
  const isViewerReviewer = input.viewer !== undefined && reviewerLogins.includes(input.viewer);

  if (authorReasons.length > 0) {
    return {
      turn: input.viewer === input.author ? 'you' : 'author',
      reasons: [...authorReasons, ...reviewerReasons],
    };
  }
  if (reviewerReasons.length > 0) {
    return { turn: isViewerReviewer ? 'you' : 'reviewers', reasons: reviewerReasons };
  }
  const isApproved = decisions.some((review) => {
    return review.verdict === 'approved' && review.commitSha === input.headSha;
  });
  if (isApproved && input.ci === 'success') {
    return {
      turn: input.viewer === input.author ? 'you' : 'author',
      reasons: ['approved on the current head with CI passing'],
    };
  }
  return { turn: 'unknown', reasons: ['nothing is waiting on anyone'] };
}

/** Each reviewer's latest approval, change request or dismissal; comments don't count. */
function latestDecisions(input: AttentionInput): PullRequestReview[] {
  const latest = new Map<string, PullRequestReview>();
  for (const review of input.reviews) {
    if (review.reviewer !== input.author && review.verdict !== 'commented') {
      latest.set(review.reviewer, review);
    }
  }
  return input.reviews.filter((review) => {
    return latest.get(review.reviewer) === review && review.verdict !== 'dismissed';
  });
}

function failingReason(count: number | undefined): string {
  if (count === undefined || count === 0) {
    return 'CI is failing';
  }
  return `CI is failing (${String(count)} ${count === 1 ? 'check' : 'checks'})`;
}
