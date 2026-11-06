import type { SheetMarksView, SheetNoteView } from '#contract/ipc-contract.ts';

export interface SheetGutterInput {
  readonly marks: SheetMarksView;
  readonly notes: readonly SheetNoteView[];
  /** Lines holding a find match; `current` is the one the find bar is on. */
  readonly matchLines: readonly number[];
  readonly currentMatchLine: number | undefined;
}

/**
 * The style rules a sheet (ADR 0067) adopts into its `@pierre/diffs` shadow root: a thin bar at
 * the inline start of the line number for added and modified lines, a small wedge at
 * the block start of the line a removal sits above, a violet dot for staged notes, and a quiet tint on
 * lines with find matches (stronger on the current one). Empty when there is nothing to draw.
 * Pure.
 */
export function sheetGutterCssFrom(input: SheetGutterInput): string {
  const rules: string[] = [];
  const bar = (line: number, color: string): void => {
    rules.push(`${number(line)}{box-shadow:inset var(--beuve-border-width-heavy) 0 0 ${color}}`);
  };
  for (const span of input.marks.added) {
    forEachLine(span, (line) => {
      bar(line, 'var(--beuve-diff-added-bar)');
    });
  }
  for (const span of input.marks.modified) {
    forEachLine(span, (line) => {
      bar(line, 'var(--beuve-accent)');
    });
  }
  for (const line of input.marks.deletedAt) {
    rules.push(
      `${number(line)}{position:relative}${number(line)}::after{content:'';position:absolute;inset-inline-start:0;inset-block-start:calc(-1 * var(--beuve-border-width-heavy));border-inline-start:calc(2 * var(--beuve-border-width-heavy)) solid var(--beuve-diff-removed-bar);border-block:var(--beuve-border-width-heavy) solid transparent}`,
    );
  }
  for (const note of input.notes) {
    forEachLine({ startLine: note.startLine, endLine: note.endLine }, (line) => {
      rules.push(
        `${number(line)}{position:relative}${number(line)}::before{content:'';position:absolute;inset-inline-end:var(--beuve-space-0-5);inset-block-start:50%;inline-size:var(--beuve-size-dot-small);block-size:var(--beuve-size-dot-small);margin-block-start:calc(var(--beuve-size-dot-small) / -2);border-radius:50%;background:var(--beuve-violet)}`,
      );
    });
  }
  const matchLines = new Set(input.matchLines);
  for (const line of matchLines) {
    let tint = 'var(--beuve-scrim-soft)';
    if (line === input.currentMatchLine) {
      tint = 'var(--beuve-accent-soft)';
    }
    rules.push(`${row(line)}{background-image:linear-gradient(${tint},${tint})}`);
  }
  return rules.join('\n');
}

function number(line: number): string {
  return `[data-column-number='${String(line)}']`;
}

function row(line: number): string {
  return `[data-line='${String(line)}']`;
}

/** Lines `startLine`–`endLine`, 1-based and inclusive. */
interface LineSpan {
  readonly startLine: number;
  readonly endLine: number;
}

function forEachLine(span: LineSpan, visit: (line: number) => void): void {
  for (let line = span.startLine; line <= span.endLine; line += 1) {
    visit(line);
  }
}
