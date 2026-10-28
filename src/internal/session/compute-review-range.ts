import type { ReviewRange, Session } from './session.ts';

/**
 * What still needs review: the whole change if never reviewed, nothing if the last
 * checkpoint is the head, otherwise the interdiff from the last reviewed commit to the head.
 */
export function computeReviewRange(session: Session): ReviewRange {
  const { review, headSha } = session;
  switch (review.kind) {
    case 'unreviewed': {
      return { kind: 'full', baseRef: session.source.baseRef, headSha };
    }
    case 'reviewed': {
      const reviewed = review.checkpoint.commitSha;
      return reviewed === headSha
        ? { kind: 'up-to-date', headSha }
        : { kind: 'interdiff', fromReviewedSha: reviewed, toHeadSha: headSha };
    }
  }
}
