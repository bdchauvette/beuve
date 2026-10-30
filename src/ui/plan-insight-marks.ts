import type { ChatFindingView, DiffHunkView } from '#contract/ipc-contract.ts';

import type { ReviewInsight } from './merge-review-insights.ts';

/** A gutter mark: the head line it sits on and the most severe finding there. */
export interface InsightMark {
  readonly line: number;
  readonly severity: ChatFindingView['severity'];
}

const rank: Readonly<Record<ChatFindingView['severity'], number>> = {
  info: 0,
  warning: 1,
  risk: 2,
};

/**
 * Where the gutter marks go (ADR 0061): each insight marks the first head line of its range that
 * a hunk shows; where several insights share a line the most severe wins. Insights citing no
 * shown line get no mark (their note sits above the first hunk). Sorted by line.
 */
export function planInsightMarks(
  hunks: readonly DiffHunkView[],
  insights: readonly ReviewInsight[],
): InsightMark[] {
  const marks = new Map<number, ChatFindingView['severity']>();
  for (const { finding } of insights) {
    const line = firstShownLine(hunks, finding);
    const before = marks.get(line ?? 0);
    if (line !== undefined && (before === undefined || rank[finding.severity] > rank[before])) {
      marks.set(line, finding.severity);
    }
  }
  return Array.from(marks, ([line, severity]) => ({ line, severity })).toSorted(
    (a, b) => a.line - b.line,
  );
}

function firstShownLine(
  hunks: readonly DiffHunkView[],
  range: { readonly startLine: number; readonly endLine: number },
): number | undefined {
  let first: number | undefined;
  for (const hunk of hunks) {
    const hunkEnd = hunk.newStart + hunk.newCount - 1;
    if (hunk.newCount === 0 || range.endLine < hunk.newStart || range.startLine > hunkEnd) {
      continue;
    }
    const line = Math.max(range.startLine, hunk.newStart);
    first = first === undefined ? line : Math.min(first, line);
  }
  return first;
}
