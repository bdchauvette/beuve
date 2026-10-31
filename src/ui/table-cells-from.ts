/**
 * The cells of a GFM table row, trimmed: split at each `|` that is neither escaped (`\|`) nor
 * inside a code span, without the optional leading and trailing pipes. Escapes stay in the
 * cells for the inline parser. Pure.
 */
export function tableCellsFrom(line: string): string[] {
  const row = line.trim();
  const cells: string[] = [];
  let cell = '';
  let index = 0;
  if (row.startsWith('|')) {
    index = 1;
  }
  while (index < row.length) {
    const character = row.charAt(index);
    if (character === '\\' && index + 1 < row.length) {
      cell += row.slice(index, index + 2);
      index += 2;
    } else if (character === '`') {
      const span = codeSpanAt(row, index);
      cell += row.slice(index, span);
      index = span;
    } else if (character === '|') {
      cells.push(cell.trim());
      cell = '';
      index += 1;
    } else {
      cell += character;
      index += 1;
    }
  }
  if (cell.trim() !== '' || !row.endsWith('|') || cells.length === 0) {
    cells.push(cell.trim());
  }
  return cells;
}

/** Where the code span opened at `start` ends, or just past its backticks if it never closes. */
function codeSpanAt(row: string, start: number): number {
  let ticks = start;
  while (row.charAt(ticks) === '`') {
    ticks += 1;
  }
  const fence = row.slice(start, ticks);
  let at = row.indexOf(fence, ticks);
  while (at !== -1) {
    const end = at + fence.length;
    if (row.charAt(end) !== '`' && row.charAt(at - 1) !== '`') {
      return end;
    }
    at = row.indexOf(fence, end);
  }
  return ticks;
}
