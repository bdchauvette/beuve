import type { DiffFile } from '#internal/git/diff-model.ts';
import type { LineSpan } from '#internal/ura/build-github-review.ts';
import { headPathOf } from '../sessions/head-path-of.ts';

/**
 * The head-side spans of a pull request's diff hunks, per path (ADR 0023): the only lines GitHub
 * accepts inline review comments on. Built from the local `base...head` diff, which is the diff
 * GitHub shows. Hunks that add nothing on the head side (pure deletions) have no span. Pure.
 */
export function commentableRangesFrom(
  files: readonly DiffFile[],
): ReadonlyMap<string, readonly LineSpan[]> {
  const ranges = new Map<string, readonly LineSpan[]>();
  for (const file of files) {
    if (file.status === 'deleted') {
      continue;
    }
    const spans = file.hunks
      .filter((hunk) => hunk.newCount > 0)
      .map((hunk) => {
        return { start: hunk.newStart, end: hunk.newStart + hunk.newCount - 1 };
      });
    if (spans.length > 0) {
      ranges.set(headPathOf(file), spans);
    }
  }
  return ranges;
}
