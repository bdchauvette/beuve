import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

export interface LineExcerpt {
  readonly startLine: number;
  readonly endLine: number;
  readonly totalLines: number;
  readonly isWholeFile: boolean;
  /** Without line terminators (`\n` or `\r\n`). */
  readonly lines: readonly string[];
}

const lineBreak = /\r?\n/u;
const finalLineBreak = /\r?\n$/u;

/** 1-based, inclusive lines to excerpt; without both, the whole file. */
export interface ExcerptRange {
  readonly startLine?: number | undefined;
  readonly endLine?: number | undefined;
}

/** A start past the file's last line. */
export interface BeyondEnd {
  readonly kind: 'beyond-end';
  readonly totalLines: number;
}

/**
 * Lines `startLine` to `endLine` (1-based, inclusive) of a file's text, or every line when both
 * are absent. An end past the last line is clamped; a start past it is an error. A final line
 * terminator does not start another line. Pure.
 */
export function excerptLines(
  text: string,
  { startLine, endLine }: ExcerptRange = {},
): Result<LineExcerpt, BeyondEnd> {
  const all = linesOf(text);
  const totalLines = all.length;
  if (startLine === undefined || endLine === undefined) {
    return ok({
      startLine: 1,
      endLine: Math.max(1, totalLines),
      totalLines,
      isWholeFile: true,
      lines: all,
    });
  }
  if (startLine > totalLines) {
    return err({ kind: 'beyond-end', totalLines });
  }
  const end = Math.min(endLine, totalLines);
  return ok({
    startLine,
    endLine: end,
    totalLines,
    isWholeFile: startLine === 1 && end === totalLines,
    lines: all.slice(startLine - 1, end),
  });
}

function linesOf(text: string): string[] {
  if (text === '') {
    return [];
  }
  return text.replace(finalLineBreak, '').split(lineBreak);
}
