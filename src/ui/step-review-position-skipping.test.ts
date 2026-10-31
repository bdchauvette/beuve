import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { stepReviewPositionSkipping } from './step-review-position-skipping.ts';

describe('stepReviewPositionSkipping', () => {
  test('steps through hunks as usual when nothing is skipped', ({ expect }) => {
    expect(
      stepReviewPositionSkipping(
        { hunkCounts: [2, 1], skipped: [false, false] },
        { file: 0, hunk: 0 },
        1,
      ),
    ).toStrictEqual({ file: 0, hunk: 1 });
  });

  test('passes over skipped files in both directions', ({ expect }) => {
    const counts = [1, 3, 0, 2];
    const skipped = [false, true, true, false];
    expect(
      stepReviewPositionSkipping({ hunkCounts: counts, skipped }, { file: 0, hunk: 0 }, 1),
    ).toStrictEqual({
      file: 3,
      hunk: 0,
    });
    expect(
      stepReviewPositionSkipping({ hunkCounts: counts, skipped }, { file: 3, hunk: 0 }, -1),
    ).toStrictEqual({
      file: 0,
      hunk: 0,
    });
  });

  test('stays put when only skipped files lie ahead', ({ expect }) => {
    expect(
      stepReviewPositionSkipping(
        { hunkCounts: [1, 2], skipped: [false, true] },
        { file: 0, hunk: 0 },
        1,
      ),
    ).toStrictEqual({ file: 0, hunk: 0 });
  });

  test('moves within a skipped file the cursor is already on', ({ expect }) => {
    expect(
      stepReviewPositionSkipping(
        { hunkCounts: [2, 1], skipped: [true, false] },
        { file: 0, hunk: 0 },
        1,
      ),
    ).toStrictEqual({ file: 0, hunk: 1 });
  });
});
