import type { DiffLayoutView } from '#contract/ipc-contract.ts';

import type { HunkStep } from './plan-hunk-steps.ts';

/** The options `setSelectedLines` takes for the step highlight. */
export interface StepHighlight {
  readonly activeLineSide: HunkStep['side'];
}

/**
 * The options for `setSelectedLines` that confine the Next/Previous Change highlight to the step's own column.
 * Split, a step on the head side would otherwise tint its paired row on the base side too;
 * inline there is one column and the library's default stands.
 */
export function planStepHighlight(
  style: DiffLayoutView,
  step: HunkStep | undefined,
): StepHighlight | undefined {
  if (style === 'split' && step !== undefined) {
    return { activeLineSide: step.side };
  }
  return undefined;
}
