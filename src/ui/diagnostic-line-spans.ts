import type { DiagnosticItemView } from '#contract/ipc-contract.ts';

/** The columns of one head line a diagnostic covers: 0-based UTF-16, the end exclusive. */
export interface DiagnosticLineSpan {
  /** 1-based. */
  readonly line: number;
  readonly start: number;
  readonly end: number;
}

/**
 * Splits a diagnostic's range into the lines the diff shows. `lengthOf` answers the length of a
 * head line's text, or `undefined` for a line that isn't on screen (collapsed, deleted-only), which
 * is skipped. A range over several lines covers the rest of its first, all of the middle ones and
 * the start of its last. An empty range, such as "expected a semicolon" at one point, is widened to
 * the character it sits on, or the one before it at the end of a line, so there is something to
 * underline. A range that reaches past the end of its line is cut there.
 */
export function diagnosticLineSpans(
  item: DiagnosticItemView,
  lengthOf: (line: number) => number | undefined,
): DiagnosticLineSpan[] {
  const spans: DiagnosticLineSpan[] = [];
  for (let line = item.startLine; line <= item.endLine; line += 1) {
    const length = lengthOf(line);
    if (length === undefined) {
      continue;
    }
    let start = 0;
    if (line === item.startLine) {
      start = item.startCharacter;
    }
    let end = length;
    if (line === item.endLine) {
      end = Math.min(item.endCharacter, length);
    }
    const span = widened({ line, start, end }, length);
    if (span !== undefined) {
      spans.push(span);
    }
  }
  return spans;
}

function widened(span: DiagnosticLineSpan, length: number): DiagnosticLineSpan | undefined {
  const { line, start, end } = span;
  if (end > start) {
    return span;
  }
  if (start < length) {
    return { line, start, end: start + 1 };
  }
  if (length > 0) {
    return { line, start: length - 1, end: length };
  }
  return undefined;
}
