import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { fuzzyMatch } from './fuzzy-match.ts';

describe('fuzzyMatch', () => {
  test('matches subsequences case-insensitively and reports the characters', ({ expect }) => {
    expect(fuzzyMatch('rvw', 'Run a preliminary review')?.indices).toHaveLength(3);
    expect(fuzzyMatch('xyz', 'review')).toBeUndefined();
    expect(fuzzyMatch('', 'anything')).toStrictEqual({ score: 0, indices: [] });
  });

  test('prefers word starts and consecutive runs', ({ expect }) => {
    const atStart = fuzzyMatch('tc', 'src/total-checkout.ts');
    expect(atStart?.indices).toStrictEqual([4, 10]);
    const words = fuzzyMatch('ct', 'checkout total')?.score ?? 0;
    const scattered = fuzzyMatch('ct', 'architecture')?.score ?? 0;
    expect(words).toBeGreaterThan(scattered);
  });

  test('ranks a shorter path above a longer one for the same match', ({ expect }) => {
    const short = fuzzyMatch('auth', 'src/auth.ts')?.score ?? 0;
    const long = fuzzyMatch('auth', 'src/deeply/nested/folder/auth.ts')?.score ?? 0;
    expect(short).toBeGreaterThan(long);
  });
});
