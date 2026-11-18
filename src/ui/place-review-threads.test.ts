import { describe } from 'vitest';

import type { ReviewThreadView } from '#contract/ipc-contract.ts';

import { placeReviewThreads } from './place-review-threads.ts';
import { test } from './testing/test.ts';

function thread(id: string, overrides: Partial<ReviewThreadView> = {}): ReviewThreadView {
  return {
    id,
    path: 'src/a.ts',
    side: 'head',
    startLine: 3,
    endLine: 4,
    sha: 'head',
    isOutdated: false,
    comments: [],
    ...overrides,
  };
}

describe('placeReviewThreads', () => {
  test('draws a current head-side thread on its lines', ({ expect }) => {
    const current = thread('1');
    expect(placeReviewThreads([current], 'head')).toStrictEqual({ inline: [current], aside: [] });
  });

  test.for<[string, Partial<ReviewThreadView>]>([
    ['is on the base side', { side: 'base' }],
    ['is outdated', { isOutdated: true }],
    ['is numbered at another commit', { sha: 'older' }],
  ])('lists a thread that %s instead', ([, overrides], { expect }) => {
    const other = thread('2', overrides);
    expect(placeReviewThreads([other], 'head')).toStrictEqual({ inline: [], aside: [other] });
  });

  test('lists a thread on a whole file, which has no lines to draw on', ({ expect }) => {
    const file: ReviewThreadView = {
      id: '5',
      path: 'src/a.ts',
      side: 'head',
      sha: 'head',
      isOutdated: false,
      comments: [],
    };
    expect(placeReviewThreads([file], 'head')).toStrictEqual({ inline: [], aside: [file] });
  });

  test('keeps each group in the order it was given', ({ expect }) => {
    const first = thread('1');
    const second = thread('2', { side: 'base' });
    const third = thread('3');
    const placement = placeReviewThreads([first, second, third], 'head');
    expect(placement.inline.map((entry) => entry.id)).toStrictEqual(['1', '3']);
    expect(placement.aside.map((entry) => entry.id)).toStrictEqual(['2']);
  });
});
