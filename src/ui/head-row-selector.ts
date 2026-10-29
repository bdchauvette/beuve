import type { DiffLayoutView } from '#contract/ipc-contract.ts';

/** Which kind of `@pierre/diffs` row a line is: an addition, a deletion or unchanged context. */
export type RowKind = 'additions' | 'deletions' | 'context';

const lineTypes: Readonly<Record<RowKind, string>> = {
  additions: 'change-addition',
  deletions: 'change-deletion',
  context: 'context',
};

/**
 * The CSS selector of one rendered row inside a `@pierre/diffs` shadow root (ADR 0042). Added and
 * context lines are found by head line number, deleted ones by base line number. Inline, every
 * row is in the one `code[data-unified]` column and context rows carry their head number. Split,
 * the head side is `code[data-additions]` and the base side `code[data-deletions]`, whose context
 * rows carry base numbers, so a head line is only ever looked up on the right.
 */
export function headRowSelector(style: DiffLayoutView, kind: RowKind, line: number): string {
  const column = style === 'unified' ? 'unified' : kind === 'deletions' ? 'deletions' : 'additions';
  return `code[data-${column}] [data-line='${String(line)}'][data-line-type='${lineTypes[kind]}']`;
}
