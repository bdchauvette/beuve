import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { adjacentMessageTop } from './adjacent-message-top.ts';

describe('adjacentMessageTop', () => {
  test('steps to the next message that starts below the view', ({ expect }) => {
    expect(adjacentMessageTop({ tops: [0, 100, 400], scrollTop: 0, step: 1 })).toBe(100);
    expect(adjacentMessageTop({ tops: [0, 100, 400], scrollTop: 150, step: 1 })).toBe(400);
  });

  test('goes back to the start of a message read halfway, then to the one before', ({ expect }) => {
    expect(adjacentMessageTop({ tops: [0, 100, 400], scrollTop: 250, step: -1 })).toBe(100);
    expect(adjacentMessageTop({ tops: [0, 100, 400], scrollTop: 100, step: -1 })).toBe(0);
  });

  test('counts a message a pixel off the top as the one already shown', ({ expect }) => {
    expect(adjacentMessageTop({ tops: [0, 100, 400], scrollTop: 99, step: 1 })).toBe(400);
    expect(adjacentMessageTop({ tops: [0, 100, 400], scrollTop: 101, step: -1 })).toBe(0);
  });

  test('stops at either end', ({ expect }) => {
    expect(adjacentMessageTop({ tops: [0, 100], scrollTop: 100, step: 1 })).toBeUndefined();
    expect(adjacentMessageTop({ tops: [0, 100], scrollTop: 0, step: -1 })).toBeUndefined();
    expect(adjacentMessageTop({ tops: [], scrollTop: 0, step: 1 })).toBeUndefined();
  });
});
