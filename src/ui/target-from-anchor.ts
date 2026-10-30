import type { DiffFileView, UraAnchorView } from '#contract/ipc-contract.ts';

import { findFirstChangedLine } from './find-first-changed-line.ts';
import type { ReviewTarget } from './target-from.ts';

/**
 * The {@link ReviewTarget} a staged note's head-side anchor (ADR 0023) names in the review shown
 * (ADR 0063), so the dock's ⌘> goes through the same adapters as the diff's: its lines as a head
 * selection, its file as the file, the change as the change. `undefined` when the anchor's file is
 * not in `files`. Pure.
 */
export function targetFromAnchor(
  anchor: UraAnchorView,
  files: readonly DiffFileView[],
): ReviewTarget | undefined {
  if (anchor.kind === 'change') {
    return { kind: 'change' };
  }
  const file = files.find((candidate) => candidate.path === anchor.path);
  if (file === undefined) {
    return undefined;
  }
  if (anchor.kind === 'file') {
    return { kind: 'file', file, line: findFirstChangedLine(file.patch) };
  }
  const head = { start: anchor.startLine, end: anchor.endLine };
  return { kind: 'selection', file, side: 'head', ...head, head };
}
