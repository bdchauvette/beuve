import { describe, expect, it } from 'vitest';

import { describeReviewPreview } from './describe-review-preview.ts';

const base = {
  sessionId: 's1',
  headSha: 'c'.repeat(40),
  verdict: 'comment' as const,
  inlineCount: 2,
  bodyCount: 1,
  alreadyPostedCount: 0,
};

describe('describeReviewPreview', () => {
  it('counts inline comments and body items', () => {
    expect(describeReviewPreview(base)).toBe(
      `2 inline comments and 1 in the review body, as Comment, on ${'c'.repeat(12)}.`,
    );
  });

  it('says when only the verdict is new', () => {
    expect(
      describeReviewPreview({
        ...base,
        verdict: 'approve',
        inlineCount: 0,
        bodyCount: 0,
        alreadyPostedCount: 1,
      }),
    ).toBe(
      `No new items, only the verdict, as Approve, on ${'c'.repeat(12)}. 1 item already posted stays out.`,
    );
  });
});
