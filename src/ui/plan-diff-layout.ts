import type { DiffFileView, DiffLayoutView } from '#contract/ipc-contract.ts';

import { minimumSplitWidth } from './minimum-split-width.ts';

/** Why a card uses the style it does, so the stream can say so. */
export type DiffLayoutReason = 'preference' | 'single-sided' | 'narrow';

/** The `@pierre/diffs` style a card renders with, and why. */
export interface DiffLayoutPlan {
  readonly style: DiffLayoutView;
  readonly reason: DiffLayoutReason;
}

/**
 * How one file's diff is laid out (ADR 0042): an added or deleted file has one side, so it uses
 * the full width as a single column; otherwise the reviewer's preference, except that a split is
 * shown inline while the stream is narrower than {@link minimumSplitWidth}. `streamWidth` is
 * `undefined` before the stream has been measured, which counts as wide enough.
 */
export function planDiffLayout(
  status: DiffFileView['status'],
  preference: DiffLayoutView,
  streamWidth: number | undefined,
): DiffLayoutPlan {
  if (status === 'added' || status === 'deleted') {
    return { style: 'unified', reason: 'single-sided' };
  }
  if (preference === 'split' && streamWidth !== undefined && streamWidth < minimumSplitWidth) {
    return { style: 'unified', reason: 'narrow' };
  }
  return { style: preference, reason: 'preference' };
}
