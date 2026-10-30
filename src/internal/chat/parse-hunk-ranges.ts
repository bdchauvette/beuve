/** A hunk's span on the head side: 1-based, inclusive line numbers. */
export interface HeadRange {
  readonly start: number;
  readonly end: number;
}

const hunkHeader = /^@@ -[\d,]+ \+(\d+),?(\d*) @@/u;

/**
 * The head-side line span of each hunk in a unified diff, in order. A hunk that only removes
 * lines has no head lines; it is anchored to the head line it follows (or line 1), so a finding
 * about a deletion has somewhere to point. Hunk content lines always start with ` `, `+`, `-` or
 * `\`, so every line starting `@@ -` is a header.
 */
export function parseHunkRanges(patch: string): HeadRange[] {
  const ranges: HeadRange[] = [];
  for (const line of patch.split('\n')) {
    const match = hunkHeader.exec(line);
    if (match === null) {
      continue;
    }
    const start = Number(match[1]);
    const count = match[2] === undefined || match[2] === '' ? 1 : Number(match[2]);
    ranges.push(
      count === 0
        ? { start: Math.max(start, 1), end: Math.max(start, 1) }
        : { start, end: start + count - 1 },
    );
  }
  return ranges;
}
