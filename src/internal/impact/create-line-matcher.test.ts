import { describe, expect, it } from 'vitest';

import { createLineMatcher } from './create-line-matcher.ts';

describe('createLineMatcher', () => {
  const isTouched = createLineMatcher([
    { start: 30, end: 31 },
    { start: 5, end: 5 },
    { start: 6, end: 8 },
    { start: 9, end: 2 },
  ]);

  it.each([
    [1, 4, false],
    [1, 5, true],
    [8, 20, true],
    [9, 29, false],
    [31, 40, true],
    [32, 40, false],
  ])('lines %i–%i intersect: %s', (start, end, expected) => {
    expect(isTouched(start, end)).toBe(expected);
  });

  it('never matches without ranges', () => {
    expect(createLineMatcher([])(1, 100)).toBe(false);
  });
});
