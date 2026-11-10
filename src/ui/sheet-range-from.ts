import type { SheetRangeView } from '#contract/ipc-contract.ts';

import type { LineRange } from './target-from.ts';

/** Whole lines `start`–`end` (1-based, inclusive) as a sheet's range (ADR 0067). Pure. */
export function sheetRangeFrom(lines: LineRange): SheetRangeView {
  return { startLine: lines.start, startCharacter: 0, endLine: lines.end, endCharacter: 0 };
}
