import type { SheetMarksView } from '#contract/ipc-contract.ts';
import type { DiffHunk } from '#internal/git/diff-model.ts';

/** A run of changed lines: how many it removes, and the head lines it adds. */
interface ChangedRun {
  removed: number;
  firstAdded: number | undefined;
  lastAdded: number;
}

/**
 * The gutter marks of a sheet (ADR 0067) from one file's hunks against the review base: each run
 * of changed lines that only adds marks its lines `added`, one that removes and adds marks the
 * added lines `modified`, and one that only removes marks the head line below the gap (the
 * last line, at the end of the file). Pure.
 */
export function sheetMarksFrom(hunks: readonly DiffHunk[], lineCount: number): SheetMarksView {
  type Span = SheetMarksView['added'][number];
  const added: Span[] = [];
  const modified: Span[] = [];
  const deletedAt: number[] = [];
  for (const hunk of hunks) {
    let nextLine = hunk.newStart;
    if (hunk.newCount === 0) {
      nextLine += 1;
    }
    let run: ChangedRun | undefined;
    const close = (): void => {
      if (run === undefined) {
        return;
      }
      if (run.firstAdded === undefined) {
        deletedAt.push(Math.max(1, Math.min(nextLine, lineCount)));
      } else {
        const span = { startLine: run.firstAdded, endLine: run.lastAdded };
        if (run.removed > 0) {
          modified.push(span);
        } else {
          added.push(span);
        }
      }
      run = undefined;
    };
    for (const line of hunk.lines) {
      if (line.kind === 'context') {
        close();
        nextLine = line.newLine + 1;
        continue;
      }
      run ??= { removed: 0, firstAdded: undefined, lastAdded: 0 };
      if (line.kind === 'removed') {
        run.removed += 1;
      } else {
        run.firstAdded ??= line.newLine;
        run.lastAdded = line.newLine;
        nextLine = line.newLine + 1;
      }
    }
    close();
  }
  return { added, modified, deletedAt: [...new Set(deletedAt)] };
}
