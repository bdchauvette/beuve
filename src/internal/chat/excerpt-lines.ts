import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

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

/**
 * Lines `startLine` to `endLine` (1-based, inclusive) of a file's text, or every line when both
 * are absent. An end past the last line is clamped; a start past it is an error. A final line
 * terminator does not start another line. Pure.
 */
export function excerptLines(
  text: string,
  startLine?: number,
  endLine?: number,
): Result<LineExcerpt, { readonly kind: 'beyond-end'; readonly totalLines: number }> {
  const all = text === '' ? [] : text.replace(finalLineBreak, '').split(lineBreak);
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
