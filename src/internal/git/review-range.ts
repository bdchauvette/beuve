import type { CommitSha } from './object-id.ts';

/** A pull-request-shaped range: the changes on `head` since it forked from `base`. */
export interface ReviewRange {
  readonly base: CommitSha;
  readonly head: CommitSha;
}
