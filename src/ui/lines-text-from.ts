/** Lines `startLine`–`endLine` of a file, 1-based and inclusive. */
export interface LineSpan {
  readonly startLine: number;
  readonly endLine: number;
}

/**
 * The text of `lines` in `contents`, `\n`-joined without a final newline, as a suggestion's
 * replacement is written (ADR 0162): a `\r` before a line's `\n` stays. `''` for an insertion
 * (`endLine` is `startLine - 1`); `undefined` when the lines are not all in the file. Pure.
 */
export function linesTextFrom(contents: string, lines: LineSpan): string | undefined {
  const { startLine, endLine } = lines;
  const all = contents.split('\n');
  if (contents.endsWith('\n')) {
    all.pop();
  }
  if (startLine < 1 || endLine < startLine - 1 || endLine > all.length) {
    return undefined;
  }
  return all.slice(startLine - 1, endLine).join('\n');
}
