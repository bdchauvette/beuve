import { describe } from 'vitest';

import { test } from '../testing/test.ts';

import { baseLinesFrom } from './base-lines-from.ts';
import type { ChangeRun } from './change-run.ts';
import type { LineRange } from './line-range.ts';

// Base 1–3 a b c, 4 removed, 5–6 e f, 7 g replaced by G G', then 8 h; head adds X after b.
function runsOf(): readonly ChangeRun[] {
  return [
    { head: { start: 3, end: 3 }, headAfter: 4, removes: false },
    { base: { start: 4, end: 4 }, headAfter: 5, removes: true },
    { base: { start: 7, end: 7 }, head: { start: 7, end: 8 }, headAfter: 9, removes: true },
  ];
}

describe('baseLinesFrom', () => {
  test.for<[string, LineRange, LineRange | undefined]>([
    ['lines before any change', { start: 1, end: 2 }, { start: 1, end: 2 }],
    ['a range with an addition and a removal inside', { start: 2, end: 5 }, { start: 2, end: 5 }],
    ['lines after an addition and a removal', { start: 5, end: 6 }, { start: 5, end: 6 }],
    ['a replacement', { start: 7, end: 8 }, { start: 7, end: 7 }],
    ['a line after a replacement', { start: 9, end: 9 }, { start: 8, end: 8 }],
    ['only added lines', { start: 3, end: 3 }, undefined],
  ])('%s', ([, head, expected], { expect }) => {
    expect(baseLinesFrom(head, runsOf())).toStrictEqual(expected);
  });
});
