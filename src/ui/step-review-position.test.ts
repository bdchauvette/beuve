import { describe, expect, it } from 'vitest';

import { stepReviewPosition } from './step-review-position.ts';
import type { ReviewPosition } from './step-review-position.ts';

const counts = [2, 0, 1];

/** Five steps from `start`. */
function walk(start: ReviewPosition, step: 1 | -1): ReviewPosition[] {
  const visited: ReviewPosition[] = [];
  let position = start;
  for (let index = 0; index < 5; index += 1) {
    position = stepReviewPosition(counts, position, step);
    visited.push(position);
  }
  return visited;
}

describe('stepReviewPosition', () => {
  it('walks every hunk forward, a hunkless file as one stop, and stops at the end', () => {
    expect(walk({ file: 0, hunk: -1 }, 1)).toEqual([
      { file: 0, hunk: 0 },
      { file: 0, hunk: 1 },
      { file: 1, hunk: -1 },
      { file: 2, hunk: 0 },
      { file: 2, hunk: 0 },
    ]);
  });

  it('walks backward to the previous file’s last hunk, and stops at the start', () => {
    expect(walk({ file: 2, hunk: -1 }, -1)).toEqual([
      { file: 1, hunk: -1 },
      { file: 0, hunk: 1 },
      { file: 0, hunk: 0 },
      { file: 0, hunk: 0 },
      { file: 0, hunk: 0 },
    ]);
  });

  it('clamps stale positions and handles an empty stream', () => {
    expect(stepReviewPosition(counts, { file: 9, hunk: 9 }, 1)).toEqual({ file: 2, hunk: 0 });
    expect(stepReviewPosition([], { file: 3, hunk: 1 }, -1)).toEqual({ file: 0, hunk: -1 });
  });
});
