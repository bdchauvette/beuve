import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { describeReviewPreview } from './describe-review-preview.ts';

function base(): Parameters<typeof describeReviewPreview>[0] {
  return {
    sessionId: 's1',
    headSha: 'c'.repeat(40),
    verdict: 'comment' as const,
    summary: '1 nit.',
    inlineCount: 2,
    bodyCount: 1,
    alreadyPostedCount: 0,
  };
}

describe('describeReviewPreview', () => {
  test('counts inline comments and body items', ({ expect }) => {
    expect(describeReviewPreview(base())).toBe(
      `2 inline comments and 1 in the review body, as Comment, on ${'c'.repeat(12)}.`,
    );
  });

  test('says when only the verdict is new', ({ expect }) => {
    expect(
      describeReviewPreview({
        ...base(),
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
