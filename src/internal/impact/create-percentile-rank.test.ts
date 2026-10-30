import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { createPercentileRank } from './create-percentile-rank.ts';

describe('createPercentileRank', () => {
  test('ranks by mid-rank against the population', ({ expect }) => {
    const rank = createPercentileRank([5, 0, 1, 1, 2, 0, 0, 3, 8, 20]);
    expect(rank(0)).toBe(15);
    expect(rank(1)).toBe(40);
    expect(rank(20)).toBe(95);
    expect(rank(21)).toBe(100);
    expect(rank(-1)).toBe(0);
  });

  test('rounds to one decimal and copes with an empty population', ({ expect }) => {
    expect(createPercentileRank([1, 2, 3])(3)).toBe(83.3);
    expect(createPercentileRank([])(3)).toBe(0);
  });
});
