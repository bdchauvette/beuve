import { describe } from 'vitest';

import { test } from '../testing/test.ts';

import { changeRunsFromMarks } from './change-runs-from-marks.ts';

describe('changeRunsFromMarks', () => {
  test('orders added, modified and removal marks by where they end', ({ expect }) => {
    const runs = changeRunsFromMarks({
      added: [{ startLine: 8, endLine: 9 }],
      modified: [{ startLine: 2, endLine: 3 }],
      deletedAt: [5],
    });
    expect(runs).toStrictEqual([
      { head: { start: 2, end: 3 }, headAfter: 4, removes: true },
      { headAfter: 5, removes: true },
      { head: { start: 8, end: 9 }, headAfter: 10, removes: false },
    ]);
  });
});
