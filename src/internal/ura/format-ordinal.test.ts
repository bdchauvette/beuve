import { describe, expect, it } from 'vitest';

import { formatOrdinal } from './format-ordinal.ts';

describe('formatOrdinal', () => {
  it.each([
    [0, '0th'],
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [97, '97th'],
    [100, '100th'],
    [111, '111th'],
  ])('%i → %s', (value, expected) => {
    expect(formatOrdinal(value)).toBe(expected);
  });
});
