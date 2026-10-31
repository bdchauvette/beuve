import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { fuzzyMatch } from './fuzzy-match.ts';

describe('fuzzyMatch', () => {
  test('matches subsequences case-insensitively and reports the characters', ({ expect }) => {
    expect(fuzzyMatch({ query: 'rvw', text: 'Run a preliminary review' })?.indices).toHaveLength(3);
    expect(fuzzyMatch({ query: 'xyz', text: 'review' })).toBeUndefined();
    expect(fuzzyMatch({ query: '', text: 'anything' })).toStrictEqual({ score: 0, indices: [] });
  });

  test('prefers word starts and consecutive runs', ({ expect }) => {
    const atStart = fuzzyMatch({ query: 'tc', text: 'src/total-checkout.ts' });
    expect(atStart?.indices).toStrictEqual([4, 10]);
    const words = fuzzyMatch({ query: 'ct', text: 'checkout total' })?.score ?? 0;
    const scattered = fuzzyMatch({ query: 'ct', text: 'architecture' })?.score ?? 0;
    expect(words).toBeGreaterThan(scattered);
  });

  test('ranks a shorter path above a longer one for the same match', ({ expect }) => {
    const short = fuzzyMatch({ query: 'auth', text: 'src/auth.ts' })?.score ?? 0;
    const long =
      fuzzyMatch({ query: 'auth', text: 'src/deeply/nested/folder/auth.ts' })?.score ?? 0;
    expect(short).toBeGreaterThan(long);
  });
});
