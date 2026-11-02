import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { placeHoverCard } from './place-hover-card.ts';

interface Size {
  readonly width: number;
  readonly height: number;
}

function viewport(): Size {
  return { width: 800, height: 600 };
}

function card(): Size {
  return { width: 300, height: 100 };
}

describe('placeHoverCard', () => {
  test('goes below the token, at the pointer', ({ expect }) => {
    expect(placeHoverCard({ x: 120, top: 200, bottom: 220 }, card(), viewport())).toStrictEqual({
      left: 120,
      top: 226,
    });
  });

  test('flips above when there is no room below but there is above', ({ expect }) => {
    expect(placeHoverCard({ x: 120, top: 540, bottom: 560 }, card(), viewport())).toStrictEqual({
      left: 120,
      top: 434,
    });
  });

  test('takes the side with more room when neither fits, and never leaves the viewport', ({
    expect,
  }) => {
    const tall = { width: 300, height: 500 };
    expect(placeHoverCard({ x: 120, top: 300, bottom: 320 }, tall, viewport())).toStrictEqual({
      left: 120,
      top: 8,
    });
    expect(placeHoverCard({ x: 120, top: 100, bottom: 120 }, tall, viewport())).toStrictEqual({
      left: 120,
      top: 126,
    });
  });

  test('keeps the card clear of the side edges', ({ expect }) => {
    const anchor = { x: 700, top: 200, bottom: 220 };
    expect(placeHoverCard(anchor, card(), viewport()).left).toBe(492);
    expect(placeHoverCard({ ...anchor, x: -40 }, card(), viewport()).left).toBe(8);
    expect(placeHoverCard({ ...anchor, x: 10 }, { width: 900, height: 50 }, viewport()).left).toBe(
      8,
    );
  });
});
