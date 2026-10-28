import type { TraceCase } from './plan-trace-timeline.ts';

/** The position of the first row inside the hunk, where focus lands; else the first row at all. */
export function findAnchorRow(
  cases: readonly TraceCase[],
): { readonly caseIndex: number; readonly rowIndex: number } | undefined {
  for (const [caseIndex, testCase] of cases.entries()) {
    const rowIndex = testCase.rows.findIndex((row) => row.inHunk);
    if (rowIndex !== -1) {
      return { caseIndex, rowIndex };
    }
  }
  const caseIndex = cases.findIndex((testCase) => testCase.rows.length > 0);
  return caseIndex === -1 ? undefined : { caseIndex, rowIndex: 0 };
}
