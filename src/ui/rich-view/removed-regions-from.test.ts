import { describe } from 'vitest';

import { test } from '../testing/test.ts';

import { removedRegionsFrom } from './removed-regions-from.ts';

describe('removedRegionsFrom', () => {
  test('keeps wholly removed regions, placed where their runs are', ({ expect }) => {
    const removed = removedRegionsFrom({
      baseRegions: [
        { start: 1, end: 2 },
        { start: 4, end: 5 },
        { start: 7, end: 8 },
        { start: 10, end: 10 },
      ],
      runs: [
        { base: { start: 4, end: 5 }, headAfter: 4, removes: true },
        { base: { start: 8, end: 8 }, headAfter: 6, removes: true },
        { base: { start: 10, end: 10 }, head: { start: 7, end: 7 }, headAfter: 8, removes: true },
      ],
    });
    expect(removed).toStrictEqual([
      { lines: { start: 4, end: 5 }, headAt: 4 },
      { lines: { start: 10, end: 10 }, headAt: 7 },
    ]);
  });
});
