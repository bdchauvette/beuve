import type { DiffLayoutView } from '#contract/ipc-contract.ts';

import type { HunkStep } from './plan-hunk-steps.ts';

/**
 * The options for `setSelectedLines` that confine the `j`/`k` highlight to the step's own column.
 * Split, a step on the head side would otherwise tint its paired row on the base side too;
 * inline there is one column and the library's default stands.
 */
export function planStepHighlight(
  style: DiffLayoutView,
  step: HunkStep | undefined,
): { readonly activeLineSide: HunkStep['side'] } | undefined {
  return style === 'split' && step !== undefined ? { activeLineSide: step.side } : undefined;
}
