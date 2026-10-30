import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { createLineMatcher } from './create-line-matcher.ts';

function isTouched(start: number, end: number): boolean {
  return createLineMatcher([
    { start: 30, end: 31 },
    { start: 5, end: 5 },
    { start: 6, end: 8 },
    { start: 9, end: 2 },
  ])(start, end);
}

describe('createLineMatcher', () => {
  test.for([
    [1, 4, false],
    [1, 5, true],
    [8, 20, true],
    [9, 29, false],
    [31, 40, true],
    [32, 40, false],
  ] as const)('lines %i–%i intersect: %s', ([start, end, expected], { expect }) => {
    expect(isTouched(start, end)).toBe(expected);
  });

  test('never matches without ranges', ({ expect }) => {
    expect(createLineMatcher([])(1, 100)).toBe(false);
  });
});
