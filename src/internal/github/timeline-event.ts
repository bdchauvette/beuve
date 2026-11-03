import type { ReviewVerdict } from './pull-request-review.ts';

/** One commit pushed to a pull request. */
export interface CommitTimelineEvent {
  readonly kind: 'commit';
  readonly sha: string;
  /** The first line of the commit message. */
  readonly headline: string;
  readonly author: string;
  /** An ISO 8601 instant. */
  readonly at: string;
  readonly url: string;
}

/** A submitted review: its verdict and the body the reviewer wrote, which may be empty. */
export interface ReviewTimelineEvent {
  readonly kind: 'review';
  readonly verdict: ReviewVerdict;
  readonly author: string;
  readonly body: string;
  readonly at: string;
  readonly url: string;
}

/** A comment in the pull request's conversation (not on a line of the diff). */
export interface CommentTimelineEvent {
  readonly kind: 'comment';
  readonly author: string;
  readonly body: string;
  readonly at: string;
  readonly url: string;
}

export type TimelineEvent = CommitTimelineEvent | ReviewTimelineEvent | CommentTimelineEvent;

/** A pull request's history, oldest first. `isTruncated` when GitHub had more pages than were read. */
export interface PullRequestTimeline {
  readonly events: readonly TimelineEvent[];
  readonly isTruncated: boolean;
}
