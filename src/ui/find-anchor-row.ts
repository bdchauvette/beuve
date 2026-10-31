import type { TraceCase } from './plan-trace-timeline.ts';

/** A row of the trace timeline: which test case, and which row of it. */
export interface TraceRowPosition {
  readonly caseIndex: number;
  readonly rowIndex: number;
}

/** The position of the first row inside the hunk, where focus lands; else the first row at all. */
export function findAnchorRow(cases: readonly TraceCase[]): TraceRowPosition | undefined {
  for (const [caseIndex, testCase] of cases.entries()) {
    const rowIndex = testCase.rows.findIndex((row) => row.inHunk);
    if (rowIndex !== -1) {
      return { caseIndex, rowIndex };
    }
  }
  const caseIndex = cases.findIndex((testCase) => testCase.rows.length > 0);
  if (caseIndex === -1) {
    return undefined;
  }
  return { caseIndex, rowIndex: 0 };
}
