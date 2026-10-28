import { describe, expect, it } from 'vitest';

import { createPercentileRank } from './create-percentile-rank.ts';

describe('createPercentileRank', () => {
  it('ranks by mid-rank against the population', () => {
    const rank = createPercentileRank([5, 0, 1, 1, 2, 0, 0, 3, 8, 20]);
    expect(rank(0)).toBe(15);
    expect(rank(1)).toBe(40);
    expect(rank(20)).toBe(95);
    expect(rank(21)).toBe(100);
    expect(rank(-1)).toBe(0);
  });

  it('rounds to one decimal and copes with an empty population', () => {
    expect(createPercentileRank([1, 2, 3])(3)).toBe(83.3);
    expect(createPercentileRank([])(3)).toBe(0);
  });
});
