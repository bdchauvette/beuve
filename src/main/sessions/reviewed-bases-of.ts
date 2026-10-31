import type { CommitSha, ReviewState } from '#internal/session/session.ts';

/** The base a review was last checked off at, for the stack-aware fork point; none if unreviewed. */
export function reviewedBasesOf(review: ReviewState): readonly CommitSha[] {
  if (review.kind === 'reviewed') {
    return [review.checkpoint.baseSha];
  }
  return [];
}
