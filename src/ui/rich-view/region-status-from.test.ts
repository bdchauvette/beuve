import { describe } from 'vitest';

import { test } from '../testing/test.ts';

import type { ChangeRun } from './change-run.ts';
import { regionStatusFrom } from './region-status-from.ts';
import type { RegionStatus } from './region-status-from.ts';

function runsOf(): readonly ChangeRun[] {
  return [
    { head: { start: 3, end: 4 }, headAfter: 5, removes: false },
    { base: { start: 9, end: 9 }, headAfter: 10, removes: true },
    { head: { start: 20, end: 20 }, base: { start: 19, end: 19 }, headAfter: 21, removes: true },
  ];
}

describe('regionStatusFrom', () => {
  test.for<[string, number, number, RegionStatus]>([
    ['untouched lines', 6, 8, 'unchanged'],
    ['every line added', 3, 4, 'added'],
    ['some lines added', 2, 4, 'modified'],
    ['a removal inside it', 8, 11, 'modified'],
    ['a removal just above it', 10, 12, 'unchanged'],
    ['a replaced line', 20, 20, 'added'],
    ['a replaced line among others', 19, 21, 'modified'],
  ])('%s', ([, start, end, expected], { expect }) => {
    expect(regionStatusFrom({ start, end }, runsOf())).toBe(expected);
  });
});
