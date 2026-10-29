import type { DiffFileView, UraItemView } from '#contract/ipc-contract.ts';

import { planEditorLine } from './plan-editor-line.ts';
import { planStageAnchor } from './plan-stage-anchor.ts';
import type { SelectedLines } from './plan-stage-anchor.ts';

/**
 * The head lines `e` edits (ADR 0043), and the staged item the suggestion attaches to, if any;
 * without one, saving opens the `m` composer with the patch.
 */
export interface EditTarget {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly itemId?: string;
  /** That note's current suggestion, which the editor starts from. */
  readonly patch?: string;
}

/**
 * What `e` edits on a card: when the cursor line (as `o` picks it) lies on the anchor of a
 * staged line note written against the head being shown, that note's lines, so the suggestion
 * attaches to it; otherwise the lines `m` would stage (the head-side selection, else the
 * focused hunk). Nothing for a deleted file, or when no hunk or lines are picked. Notes from an
 * older head are skipped: their lines number a different file.
 */
export function planEditTarget(
  file: DiffFileView,
  activeHunk: number,
  selection: SelectedLines | undefined,
  items: readonly UraItemView[],
  headSha: string,
): EditTarget | undefined {
  if (file.status === 'deleted' || file.binary) {
    return undefined;
  }
  const anchor = planStageAnchor(file.path, file.hunks[activeHunk], selection);
  if (anchor.kind !== 'lines') {
    return undefined;
  }
  const cursor = planEditorLine(file, activeHunk, selection);
  const item = items.find(
    ({ status, headSha: itemHead, anchor: own, placement }) =>
      status.kind === 'staged' &&
      itemHead === headSha &&
      placement.kind === 'current' &&
      own.kind === 'lines' &&
      own.path === file.path &&
      own.startLine <= cursor &&
      cursor <= own.endLine,
  );
  return item?.anchor.kind === 'lines'
    ? {
        path: file.path,
        startLine: item.anchor.startLine,
        endLine: item.anchor.endLine,
        itemId: item.id,
        ...(item.suggestedPatch !== undefined && { patch: item.suggestedPatch }),
      }
    : { path: file.path, startLine: anchor.startLine, endLine: anchor.endLine };
}
