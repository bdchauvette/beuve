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
  return Array.from(marks, ([line, severity]) => {
    return { line, severity };
  }).toSorted((a, b) => {
    return a.line - b.line;
  });
}

function firstShownLine(
  hunks: readonly DiffHunkView[],
  range: Pick<ChatFindingView, 'startLine' | 'endLine'>,
): number | undefined {
  const starts = hunks
    .filter((hunk) => {
      const hunkEnd = hunk.newStart + hunk.newCount - 1;
      return hunk.newCount > 0 && range.endLine >= hunk.newStart && range.startLine <= hunkEnd;
    })
    .map((hunk) => Math.max(range.startLine, hunk.newStart));
  if (starts.length === 0) {
    return undefined;
  }
  return Math.min(...starts);
}
