/** One side of a hunk header, `@@ -start,count` or `+start,count`. */
export interface HunkSpan {
  readonly start: number;
  readonly count: number;
}

/**
 * The first line a hunk side covers. An empty side (count 0) names the line before its gap, so
 * the first line after the gap is the next one. Pure.
 */
export function firstHunkLine(span: HunkSpan): number {
  if (span.count === 0) {
    return span.start + 1;
  }
  return span.start;
}
