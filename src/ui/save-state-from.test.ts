import { describe } from 'vitest';

import type { ReviewView } from '#contract/ipc-contract.ts';

import { saveStateFrom } from './save-state-from.ts';
import { createReviewView } from './testing/create-review-view.ts';
import { test } from './testing/test.ts';

describe('saveStateFrom', () => {
  test('says nothing without a review, and saving while a save runs', ({ expect }) => {
    expect(
      saveStateFrom({ review: undefined, savedProgress: undefined, isMarking: false }),
    ).toBeUndefined();
    expect(
      saveStateFrom({ review: createReviewView(), savedProgress: undefined, isMarking: true }),
    ).toStrictEqual({ kind: 'saving' });
  });

  test('is unsaved since the last checkpoint, or since nothing', ({ expect }) => {
    expect(
      saveStateFrom({ review: createReviewView(), savedProgress: undefined, isMarking: false }),
    ).toStrictEqual({ kind: 'unsaved' });
    const saved = 'b'.repeat(40);
    const review = reviewSavedAt(saved);
    expect(saveStateFrom({ review, savedProgress: undefined, isMarking: false })).toStrictEqual({
      kind: 'unsaved',
      since: saved,
    });
  });

  test('is saved at the head by the loaded checkpoint, with its time', ({ expect }) => {
    const head = 'a'.repeat(40);
    expect(
      saveStateFrom({ review: reviewSavedAt(head), savedProgress: undefined, isMarking: false }),
    ).toStrictEqual({ kind: 'saved', sha: head, at: '2026-11-24T10:00:00Z' });
  });

  test("is saved by this window's save that kept the review shown", ({ expect }) => {
    const review = reviewSavedAt('b'.repeat(40));
    const at = Temporal.Instant.from('2026-11-24T11:37:00Z');
    expect(
      saveStateFrom({
        review,
        savedProgress: { sessionId: 's1', sha: review.headSha, at },
        isMarking: false,
      }),
    ).toStrictEqual({ kind: 'saved', sha: review.headSha, at: at.toString() });
  });
});

/** A review of head `a…` in session `s1` whose last checkpoint saved `sha`. */
function reviewSavedAt(sha: string): ReviewView {
  const review = createReviewView({ sessionId: 's1' });
  return {
    ...review,
    session: { ...review.session, lastReviewedSha: sha },
    range: {
      choice: { kind: 'since-last' },
      checkpoints: [
        { id: 'c1', baseSha: 'c'.repeat(40), headSha: sha, savedAt: '2026-11-24T10:00:00Z' },
      ],
    },
  };
}
