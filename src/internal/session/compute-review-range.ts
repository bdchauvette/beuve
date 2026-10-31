import type { ReviewRange, Session } from './session.ts';

/**
 * What still needs review: the whole change if never reviewed, nothing if the last
 * checkpoint is the head, otherwise the interdiff from the last reviewed range to the head.
 */
export function computeReviewRange(session: Session): ReviewRange {
  const { review, headSha, source } = session;
  switch (review.kind) {
    case 'unreviewed': {
      return { kind: 'full', baseRef: source.baseRef, headSha };
    }
    case 'reviewed': {
      const { baseSha, headSha: reviewedSha } = review.checkpoint;
      if (reviewedSha === headSha) {
        return { kind: 'up-to-date', headSha };
      }
      return {
        kind: 'interdiff',
        baseRef: source.baseRef,
        fromBaseSha: baseSha,
        fromHeadSha: reviewedSha,
        toHeadSha: headSha,
      };
    }
  }
}
