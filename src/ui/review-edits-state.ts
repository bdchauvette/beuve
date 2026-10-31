import type {
  ReviewEditsDiscardView,
  ReviewEditsPlanView,
  ReviewEditsView,
} from '#contract/ipc-contract.ts';

/**
 * Where an action on the session's review edits stands (ADR 0088): idle, waiting for main,
 * previewing what Turn into Suggestions would stage, confirming what Discard would lose, done
 * (with what happened) or failed. Nothing is staged or discarded without the confirmation step.
 */
export type ReviewEditsFlow =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy'; readonly text: string }
  | { readonly kind: 'preview'; readonly plan: ReviewEditsPlanView }
  | { readonly kind: 'discard'; readonly loss: ReviewEditsDiscardView }
  | { readonly kind: 'done'; readonly text: string }
  | { readonly kind: 'failed'; readonly text: string };

/** What the dock shows of the session's review edits. */
export interface ReviewEditsDockState {
  readonly view: ReviewEditsView | undefined;
  readonly flow: ReviewEditsFlow;
}
