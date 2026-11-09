import type { DiffHunkView, UraAnchorView } from '#contract/ipc-contract.ts';

/**
 * Whether a line anchor's head lines lie outside every hunk of its file (ADR 0123): GitHub takes
 * comments only on lines its diff shows, so such a note goes in the review body when posted
 * (ADR 0023). File and whole-change anchors are never outside. Pure.
 */
export function isOutsideHunks(anchor: UraAnchorView, hunks: readonly DiffHunkView[]): boolean {
  if (anchor.kind !== 'lines') {
    return false;
  }
  return !hunks.some((hunk) => {
    const last = hunk.newStart + Math.max(hunk.newCount, 1) - 1;
    return hunk.newCount > 0 && hunk.newStart <= anchor.endLine && anchor.startLine <= last;
  });
}
