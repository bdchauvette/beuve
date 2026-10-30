/** A submitted review's verdict; a `pending` (unsubmitted) review is never listed. */
export type ReviewVerdict = 'approved' | 'changes-requested' | 'commented' | 'dismissed';

/** One submitted review of a pull request (`GET …/pulls/{n}/reviews`). */
export interface PullRequestReview {
  /** The reviewer's login, `ghost` for a deleted account. */
  readonly reviewer: string;
  readonly verdict: ReviewVerdict;
  /** The commit the review was made on; the pull request's head may have moved since. */
  readonly commitSha: string | undefined;
  readonly submittedAt: string;
}

/** Who a pull request is waiting on for a review (`GET …/pulls/{n}/requested_reviewers`). */
export interface ReviewRequests {
  /** Logins. */
  readonly users: readonly string[];
  /** Team slugs. */
  readonly teams: readonly string[];
}
