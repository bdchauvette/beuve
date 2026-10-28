import type { LineRange } from './impact-input.ts';

/**
 * Answers "does `start..end` intersect any of these ranges?" in O(log n), after sorting and
 * merging the ranges once. Lines are 1-based and inclusive.
 */
export function createLineMatcher(
  ranges: readonly LineRange[],
): (start: number, end: number) => boolean {
  const merged = merge(ranges);
  return (start: number, end: number): boolean => {
    let low = 0;
    let high = merged.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if ((merged[middle]?.end ?? 0) < start) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    const candidate = merged[low];
    return candidate !== undefined && candidate.start <= end;
  };
}

function merge(ranges: readonly LineRange[]): readonly LineRange[] {
  const sorted = ranges
    .filter((range) => range.start <= range.end)
    .toSorted((left, right) => left.start - right.start);
  const merged: LineRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && range.start <= last.end + 1) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, range.end) };
    } else {
      merged.push(range);
    }
  }
  return merged;
}
