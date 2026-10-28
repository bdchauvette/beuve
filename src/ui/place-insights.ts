import { splitPatch } from './split-patch.ts';

/** Anything with a 1-based, inclusive head-side line range. */
export interface HeadSideRange {
  readonly lineStart: number;
  readonly lineEnd: number;
}

export interface InsightPlacement<T extends HeadSideRange> {
  /** By index into `splitPatch(patch)`: insights shown right after that line. */
  readonly afterLine: ReadonlyMap<number, readonly T[]>;
  /** Insights whose lines the patch doesn't show; the card lists them above the diff. */
  readonly unplaced: readonly T[];
}

const hunkHeader = /^@@ \S+ \+(\d+)/u;

/**
 * Where insights go in the `<pre>` renderer: after the last patch line that shows a head line in
 * the insight's range (and after a following "\ No newline" note). Removed lines have no head line.
 * The `@pierre/diffs` renderer (ADR 0018) can take the same insights as line annotations instead.
 */
export function placeInsights<T extends HeadSideRange>(
  patch: string,
  insights: readonly T[],
): InsightPlacement<T> {
  const lines = splitPatch(patch);
  const headLines: (number | undefined)[] = [];
  let next = 0;
  for (const line of lines) {
    if (line.kind === 'hunk') {
      next = Number(hunkHeader.exec(line.text)?.[1] ?? 0);
      headLines.push(undefined);
    } else if (line.kind === 'context' || line.kind === 'added') {
      headLines.push(next);
      next += 1;
    } else {
      headLines.push(undefined);
    }
  }

  const afterLine = new Map<number, T[]>();
  const unplaced: T[] = [];
  for (const insight of insights) {
    let index = headLines.findLastIndex(
      (head) => head !== undefined && head >= insight.lineStart && head <= insight.lineEnd,
    );
    if (index === -1) {
      unplaced.push(insight);
      continue;
    }
    while (lines[index + 1]?.kind === 'note') {
      index += 1;
    }
    afterLine.set(index, [...(afterLine.get(index) ?? []), insight]);
  }
  return { afterLine, unplaced };
}
