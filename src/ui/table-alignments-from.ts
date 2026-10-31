import type { TableAlignment } from './markdown-tree.ts';
import { tableCellsFrom } from './table-cells-from.ts';

const delimiterCell = /^(:?)-+(:?)$/u;

/**
 * A GFM table's delimiter row (`| --- | :-: | --: |`) as one alignment per column, or
 * `undefined` when the line is not one. It must contain a `|`: a bare `---` is a rule. Pure.
 */
export function tableAlignmentsFrom(line: string): TableAlignment[] | undefined {
  if (!line.includes('|')) {
    return undefined;
  }
  const alignments: TableAlignment[] = [];
  for (const cell of tableCellsFrom(line)) {
    const delimiter = delimiterCell.exec(cell.replaceAll(' ', ''));
    if (delimiter === null) {
      return undefined;
    }
    const [, left, right] = delimiter;
    alignments.push(alignmentOf(left, right));
  }
  return alignments;
}

/** A delimiter cell's colons: both for centered, one on its side, none for the default. */
function alignmentOf(left: string | undefined, right: string | undefined): TableAlignment {
  if (left === ':' && right === ':') {
    return 'center';
  }
  if (right === ':') {
    return 'right';
  }
  if (left === ':') {
    return 'left';
  }
  return undefined;
}
