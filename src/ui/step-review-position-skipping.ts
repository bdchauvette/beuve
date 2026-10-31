import { stepReviewPosition } from './step-review-position.ts';
import type { ReviewPosition } from './step-review-position.ts';

/** The stops in stream order: each file's hunk count, and whether stepping passes over it. */
export interface ReviewStops {
  readonly hunkCounts: readonly number[];
  readonly skipped: readonly boolean[];
}

/**
 * {@link stepReviewPosition}, passing over the files `skipped` marks (reviewed files, when the
 * reviewer asked Next/Previous Change to skip them, ADR 0064). When every stop that way is skipped, the
 * position stays where it was. Pure.
 */
export function stepReviewPositionSkipping(
  { hunkCounts, skipped }: ReviewStops,
  position: ReviewPosition,
  step: 1 | -1,
): ReviewPosition {
  let current = position;
  for (;;) {
    const next = stepReviewPosition(hunkCounts, current, step);
    if (next.file === current.file && next.hunk === current.hunk) {
      return position;
    }
    if (skipped[next.file] !== true || next.file === position.file) {
      return next;
    }
    current = next;
  }
}
