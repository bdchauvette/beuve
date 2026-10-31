import type { ReviewEditsFlow } from './review-edits-state.ts';

/**
 * Drops a finished action's status line ("done" or "failed") when the session is selected or
 * reloaded again, or another review-edits action starts (ADR 0088). An action still waiting on
 * main and a preview or discard awaiting confirmation stay: main checks their digest again, and
 * the waiting action reports into the flow when it answers.
 */
export function clearReviewEditsStatus(flow: ReviewEditsFlow): ReviewEditsFlow {
  switch (flow.kind) {
    case 'done':
    case 'failed': {
      return { kind: 'idle' };
    }
    default: {
      return flow;
    }
  }
}
