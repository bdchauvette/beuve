import type { DiffHunkView, UraAnchorView } from '#contract/ipc-contract.ts';

/** A line range selected in a diff card, as `@pierre/diffs` reports it. */
export interface SelectedLines {
  readonly start: number;
  readonly end: number;
  readonly side?: 'additions' | 'deletions';
  readonly endSide?: 'additions' | 'deletions';
}

/**
 * Where `m` stages a note: the card's line selection when it lies on the head side; otherwise
 * the focused hunk's head lines (a pure deletion keeps the head line it sits after, or line 1);
 * otherwise, with no hunk focused, the whole file. URA anchors are head-side only (ADR 0023).
 */
export function planStageAnchor(
  path: string,
  hunk: DiffHunkView | undefined,
  selection: SelectedLines | undefined,
): UraAnchorView {
  if (selection !== undefined && isHeadSide(selection)) {
    const startLine = Math.max(1, Math.min(selection.start, selection.end));
    const endLine = Math.max(startLine, selection.start, selection.end);
    return { kind: 'lines', path, startLine, endLine };
  }
  if (hunk === undefined) {
    return { kind: 'file', path };
  }
  if (hunk.newCount === 0) {
    const line = Math.max(1, hunk.newStart);
    return { kind: 'lines', path, startLine: line, endLine: line };
  }
  return {
    kind: 'lines',
    path,
    startLine: hunk.newStart,
    endLine: hunk.newStart + hunk.newCount - 1,
  };
}

function isHeadSide(selection: SelectedLines): boolean {
  return (
    (selection.side ?? 'additions') === 'additions' &&
    (selection.endSide ?? selection.side ?? 'additions') === 'additions'
  );
}
