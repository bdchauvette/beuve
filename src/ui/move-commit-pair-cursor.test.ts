import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { moveCommitPairCursor } from './move-commit-pair-cursor.ts';

describe('moveCommitPairCursor', () => {
  test('steps and clamps with j/k and the arrows, and jumps with Home/End', ({ expect }) => {
    expect(moveCommitPairCursor(0, 3, 'j')).toBe(1);
    expect(moveCommitPairCursor(2, 3, 'ArrowDown')).toBe(2);
    expect(moveCommitPairCursor(1, 3, 'k')).toBe(0);
    expect(moveCommitPairCursor(0, 3, 'ArrowUp')).toBe(0);
    expect(moveCommitPairCursor(1, 3, 'Home')).toBe(0);
    expect(moveCommitPairCursor(0, 3, 'End')).toBe(2);
  });

  test('clamps a stale cursor and ignores other keys and empty lists', ({ expect }) => {
    expect(moveCommitPairCursor(9, 3, 'k')).toBe(1);
    expect(moveCommitPairCursor(-1, 3, 'j')).toBe(1);
    expect(moveCommitPairCursor(0, 3, 'x')).toBeUndefined();
    expect(moveCommitPairCursor(0, 0, 'j')).toBeUndefined();
  });
});
