import { describe, expect, it } from 'vitest';

import { fuzzyMatch } from './fuzzy-match.ts';

describe('fuzzyMatch', () => {
  it('matches subsequences case-insensitively and reports the characters', () => {
    expect(fuzzyMatch('rvw', 'Run a preliminary review')?.indices).toHaveLength(3);
    expect(fuzzyMatch('xyz', 'review')).toBeUndefined();
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, indices: [] });
  });

  it('prefers word starts and consecutive runs', () => {
    const atStart = fuzzyMatch('tc', 'src/total-checkout.ts');
    expect(atStart?.indices).toEqual([4, 10]);
    const words = fuzzyMatch('ct', 'checkout total')?.score ?? 0;
    const scattered = fuzzyMatch('ct', 'architecture')?.score ?? 0;
    expect(words).toBeGreaterThan(scattered);
  });

  it('ranks a shorter path above a longer one for the same match', () => {
    const short = fuzzyMatch('auth', 'src/auth.ts')?.score ?? 0;
    const long = fuzzyMatch('auth', 'src/deeply/nested/folder/auth.ts')?.score ?? 0;
    expect(short).toBeGreaterThan(long);
  });
});
