import { describe, expect, it } from 'vitest';

import { describeReviewSummary } from './describe-review-summary.ts';

const none = { unknownFile: 0, outsideDiff: 0, lowConfidence: 0, duplicate: 0, overLimit: 0 };

describe('describeReviewSummary', () => {
  it('names a single drop reason without repeating the count', () => {
    expect(
      describeReviewSummary({
        insightCount: 4,
        droppedCount: 2,
        dropped: { ...none, outsideDiff: 2 },
      }),
    ).toBe('4 insights, 2 dropped (out of diff)');
  });

  it('counts several reasons', () => {
    expect(
      describeReviewSummary({
        insightCount: 1,
        droppedCount: 3,
        dropped: { ...none, outsideDiff: 2, lowConfidence: 1 },
      }),
    ).toBe('1 insight, 3 dropped (2 out of diff, 1 low confidence)');
  });

  it('omits drops when there are none, and reasons a stored run lacks', () => {
    expect(describeReviewSummary({ insightCount: 0, droppedCount: 0 })).toBe('0 insights');
    expect(describeReviewSummary({ insightCount: 2, droppedCount: 1 })).toBe(
      '2 insights, 1 dropped',
    );
  });
});
