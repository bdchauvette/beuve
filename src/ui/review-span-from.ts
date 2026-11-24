import type { ReviewView } from '#contract/ipc-contract.ts';

/** The commits a review's diff spans, for the status bar (ADR 0157 amendment). */
export interface ReviewSpan {
  readonly from: string;
  readonly to: string;
  /** Spells the span out, for the tooltip. */
  readonly title: string;
}

/**
 * The commits the diff spans: the fork point to the head, or for an interdiff the last reviewed
 * head to the head. `undefined` without a review. Pure.
 */
export function reviewSpanFrom(review: ReviewView | undefined): ReviewSpan | undefined {
  if (review === undefined) {
    return undefined;
  }
  if (review.scope.kind === 'interdiff') {
    const from = review.scope.fromHeadSha;
    return {
      from,
      to: review.headSha,
      title: `Changes since reviewed head ${from}, now at ${review.headSha} (forked from ${review.baseSha})`,
    };
  }
  return {
    from: review.baseSha,
    to: review.headSha,
    title: `${review.baseSha}..${review.headSha}`,
  };
}
