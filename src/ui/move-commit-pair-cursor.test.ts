import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { moveCommitPairCursor } from './move-commit-pair-cursor.ts';

describe('moveCommitPairCursor', () => {
  test('steps and clamps with the arrows, and jumps with Home/End', ({ expect }) => {
    expect(moveCommitPairCursor('ArrowDown', { cursor: 0, count: 3 })).toBe(1);
    expect(moveCommitPairCursor('ArrowDown', { cursor: 2, count: 3 })).toBe(2);
    expect(moveCommitPairCursor('ArrowUp', { cursor: 1, count: 3 })).toBe(0);
    expect(moveCommitPairCursor('ArrowUp', { cursor: 0, count: 3 })).toBe(0);
    expect(moveCommitPairCursor('Home', { cursor: 1, count: 3 })).toBe(0);
    expect(moveCommitPairCursor('End', { cursor: 0, count: 3 })).toBe(2);
  });

  test('clamps a stale cursor and ignores other keys and empty lists', ({ expect }) => {
    expect(moveCommitPairCursor('ArrowUp', { cursor: 9, count: 3 })).toBe(1);
    expect(moveCommitPairCursor('ArrowDown', { cursor: -1, count: 3 })).toBe(1);
    expect(moveCommitPairCursor('x', { cursor: 0, count: 3 })).toBeUndefined();
    expect(moveCommitPairCursor('ArrowDown', { cursor: 0, count: 0 })).toBeUndefined();
  });

  test('leaves letters alone', ({ expect }) => {
    expect(moveCommitPairCursor('j', { cursor: 0, count: 3 })).toBeUndefined();
  });
});
