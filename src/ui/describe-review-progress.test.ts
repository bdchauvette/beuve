import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { describeReviewProgress } from './describe-review-progress.ts';

describe('describeReviewProgress', () => {
  test('counts reviewed files and names the changed and unmarked ones on hover', ({ expect }) => {
    expect(
      describeReviewProgress({ total: 30, reviewed: 12, changedSince: 2, unreviewed: 16 }),
    ).toStrictEqual({
      text: '12/30 reviewed',
      title:
        '12 of 30 files marked reviewed, 2 changed since you marked them, 16 not marked. v marks the focused file.',
    });
    expect(
      describeReviewProgress({ total: 1, reviewed: 1, changedSince: 0, unreviewed: 0 }),
    ).toStrictEqual({
      text: '1/1 reviewed',
      title: '1 of 1 file marked reviewed. v marks the focused file.',
    });
  });

  test('says nothing without files', ({ expect }) => {
    expect(describeReviewProgress(undefined)).toBeUndefined();
    expect(
      describeReviewProgress({ total: 0, reviewed: 0, changedSince: 0, unreviewed: 0 }),
    ).toBeUndefined();
  });
});
