import type { Checkpoint, ReviewRange, ReviewRangeChoice, Session } from './session.ts';

const sinceLast: ReviewRangeChoice = { kind: 'since-last' };

/**
 * What the review shows (ADR 0012, 0141). By default, what still needs review: the whole change if
 * never reviewed, nothing if the last checkpoint is the head, otherwise the interdiff from the last
 * reviewed range to the head. `whole` is the whole change whatever was saved, and
 * `since-checkpoint` the interdiff from the chosen checkpoint instead of the last one.
 */
export function computeReviewRange(
  session: Session,
  choice: ReviewRangeChoice = sinceLast,
): ReviewRange {
  const { review, headSha, source } = session;
  switch (choice.kind) {
    case 'whole': {
      return { kind: 'full', baseRef: source.baseRef, headSha };
    }
    case 'since-checkpoint': {
      return rangeSince(session, choice.checkpoint);
    }
    case 'since-last': {
      if (review.kind === 'unreviewed') {
        return { kind: 'full', baseRef: source.baseRef, headSha };
      }
      return rangeSince(session, review.checkpoint);
    }
  }
}

function rangeSince(session: Session, checkpoint: Checkpoint): ReviewRange {
  const { baseSha, headSha: reviewedSha } = checkpoint;
  if (reviewedSha === session.headSha) {
    return { kind: 'up-to-date', headSha: session.headSha };
  }
  return {
    kind: 'interdiff',
    baseRef: session.source.baseRef,
    fromBaseSha: baseSha,
    fromHeadSha: reviewedSha,
    toHeadSha: session.headSha,
  };
}
