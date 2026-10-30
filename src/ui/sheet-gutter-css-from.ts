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
 * the left of the line number for added (green) and modified (blue) lines, a small red wedge at
 * the top of the line a removal sits above, a violet dot for staged notes, and a quiet tint on
 * lines with find matches (stronger on the current one). Empty when there is nothing to draw.
 * Pure.
 */
export function sheetGutterCssFrom(input: SheetGutterInput): string {
  const rules: string[] = [];
  const bar = (line: number, color: string): void => {
    rules.push(`${number(line)}{box-shadow:inset 3px 0 0 ${color}}`);
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
      `${number(line)}{position:relative}${number(line)}::after{content:'';position:absolute;left:0;top:-3px;border-left:6px solid var(--beuve-diff-removed-bar);border-top:3px solid transparent;border-bottom:3px solid transparent}`,
    );
  }
  for (const note of input.notes) {
    forEachLine({ startLine: note.startLine, endLine: note.endLine }, (line) => {
      rules.push(
        `${number(line)}{position:relative}${number(line)}::before{content:'';position:absolute;right:2px;top:50%;width:5px;height:5px;margin-top:-2.5px;border-radius:50%;background:var(--beuve-violet)}`,
      );
    });
  }
  const matchLines = new Set(input.matchLines);
  for (const line of matchLines) {
    const tint =
      line === input.currentMatchLine ? 'var(--beuve-accent-soft)' : 'var(--beuve-scrim-soft)';
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

function forEachLine(
  span: { readonly startLine: number; readonly endLine: number },
  visit: (line: number) => void,
): void {
  for (let line = span.startLine; line <= span.endLine; line += 1) {
    visit(line);
  }
}
