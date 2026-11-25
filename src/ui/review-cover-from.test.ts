import { describe } from 'vitest';

import type { ReviewCoverInput } from './review-cover-from.ts';
import { reviewCoverFrom } from './review-cover-from.ts';
import { test } from './testing/test.ts';

describe('reviewCoverFrom', () => {
  test('covers a labeled fetch, which can be cancelled', ({ expect }) => {
    const cover = reviewCoverFrom(
      inputWith({
        fetch: { kind: 'open', stage: 'Fetching pull request #12…', label: 'acme/app#12' },
        hasReview: true,
      }),
    );
    expect(cover).toStrictEqual({
      label: 'acme/app#12',
      stage: 'Fetching pull request #12…',
      cancellable: true,
    });
  });

  test('leaves the Open panel’s fetch and a reload uncovered', ({ expect }) => {
    expect(
      reviewCoverFrom(inputWith({ fetch: { kind: 'open', stage: 'Fetching…', label: '' } })),
    ).toBeUndefined();
    expect(
      reviewCoverFrom(
        inputWith({ fetch: { kind: 'reload', stage: 'Fetching…', label: 'x' }, hasReview: true }),
      ),
    ).toBeUndefined();
  });

  test('keeps covering while the picked session’s review is read', ({ expect }) => {
    const cover = reviewCoverFrom(inputWith({ isLoading: true, loadingLabel: 'app · feature' }));
    expect(cover).toStrictEqual({
      label: 'app · feature',
      stage: 'Opening review…',
      cancellable: false,
    });
  });

  test('does not cover a review reloading in place, or an idle window', ({ expect }) => {
    expect(reviewCoverFrom(inputWith({ isLoading: true, hasReview: true }))).toBeUndefined();
    expect(reviewCoverFrom(inputWith({}))).toBeUndefined();
  });
});

function inputWith(overrides: Partial<ReviewCoverInput>): ReviewCoverInput {
  return { fetch: undefined, isLoading: false, hasReview: false, loadingLabel: '', ...overrides };
}
