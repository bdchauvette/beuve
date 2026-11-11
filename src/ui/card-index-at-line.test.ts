import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { cardIndexAtLine } from './card-index-at-line.ts';
import type { CardSpan } from './card-index-at-line.ts';

/** Three cards 100 tall with a 10 gap between them, starting at 0. */
function spans(): CardSpan[] {
  return [
    { blockStart: 0, blockEnd: 100 },
    { blockStart: 110, blockEnd: 210 },
    { blockStart: 220, blockEnd: 320 },
  ];
}

describe('cardIndexAtLine', () => {
  test('is the card that spans the line', ({ expect }) => {
    expect(cardIndexAtLine(spans(), 150)).toBe(1);
  });

  test('is the first card while the line is above them all', ({ expect }) => {
    expect(cardIndexAtLine(spans(), -40)).toBe(0);
  });

  test('is the next card while the line is in the gap after one', ({ expect }) => {
    expect(cardIndexAtLine(spans(), 100)).toBe(1);
  });

  test('is -1 once every card has scrolled above the line', ({ expect }) => {
    expect(cardIndexAtLine(spans(), 320)).toBe(-1);
  });
});
