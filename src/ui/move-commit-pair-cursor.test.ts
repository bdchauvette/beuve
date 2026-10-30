import { describe, expect, it } from 'vitest';

import { moveCommitPairCursor } from './move-commit-pair-cursor.ts';

describe('moveCommitPairCursor', () => {
  it('steps and clamps with j/k and the arrows, and jumps with Home/End', () => {
    expect(moveCommitPairCursor(0, 3, 'j')).toBe(1);
    expect(moveCommitPairCursor(2, 3, 'ArrowDown')).toBe(2);
    expect(moveCommitPairCursor(1, 3, 'k')).toBe(0);
    expect(moveCommitPairCursor(0, 3, 'ArrowUp')).toBe(0);
    expect(moveCommitPairCursor(1, 3, 'Home')).toBe(0);
    expect(moveCommitPairCursor(0, 3, 'End')).toBe(2);
  });

  it('clamps a stale cursor and ignores other keys and empty lists', () => {
    expect(moveCommitPairCursor(9, 3, 'k')).toBe(1);
    expect(moveCommitPairCursor(-1, 3, 'j')).toBe(1);
    expect(moveCommitPairCursor(0, 3, 'x')).toBeUndefined();
    expect(moveCommitPairCursor(0, 0, 'j')).toBeUndefined();
  });
});
