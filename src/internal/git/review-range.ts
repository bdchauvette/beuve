import type { CommitSha } from './object-id.ts';

/** A pull-request-shaped range: the changes on `head` since it forked from `base`. */
export interface ReviewRange {
  readonly base: CommitSha;
  readonly head: CommitSha;
}

/** A previously reviewed range and the one to review now, each from its own fork point. */
export interface ReviewRanges {
  readonly previous: ReviewRange;
  readonly next: ReviewRange;
}
