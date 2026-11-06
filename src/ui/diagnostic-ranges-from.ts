import type { DiagnosticItemView } from '#contract/ipc-contract.ts';

import { diagnosticLineSpans } from './diagnostic-line-spans.ts';
import type { DiagnosticRange } from './diagnostic-highlights.ts';
import { textRangeIn } from './text-range-in.ts';

/**
 * The DOM ranges to underline for `items`, on the rows `rowOf` finds: a head line's row holds the
 * line's code text and nothing else, so a column of the file is a character offset into its text.
 * A line without a row (collapsed in a diff, not rendered yet) gets no range.
 */
export function diagnosticRangesFrom(
  items: readonly DiagnosticItemView[],
  rowOf: (line: number) => HTMLElement | undefined,
): DiagnosticRange[] {
  const rows = new Map<number, HTMLElement | undefined>();
  const cachedRowOf = (line: number): HTMLElement | undefined => {
    if (!rows.has(line)) {
      rows.set(line, rowOf(line));
    }
    return rows.get(line);
  };
  const ranges: DiagnosticRange[] = [];
  for (const item of items) {
    const spans = diagnosticLineSpans(item, (line) => cachedRowOf(line)?.textContent.length);
    for (const span of spans) {
      const row = cachedRowOf(span.line);
      const range = row && textRangeIn(row, { start: span.start, end: span.end });
      if (range) {
        ranges.push({ severity: item.severity, range });
      }
    }
  }
  return ranges;
}
