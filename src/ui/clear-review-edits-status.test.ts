import { describe } from 'vitest';

import type { ReviewEditsDiscardView, ReviewEditsPlanView } from '#contract/ipc-contract.ts';

import { clearReviewEditsStatus } from './clear-review-edits-status.ts';
import type { ReviewEditsFlow } from './review-edits-state.ts';
import { test } from './testing/test.ts';

describe('clearReviewEditsStatus', () => {
  test.for<ReviewEditsFlow>([
    { kind: 'done', text: 'Staged: 1 new, 0 attached to notes, 0 updated, 0 already there.' },
    { kind: 'failed', text: 'The review edits changed since the preview.' },
  ])('clears a finished action’s $kind line', (flow, { expect }) => {
    expect(clearReviewEditsStatus(flow)).toStrictEqual({ kind: 'idle' });
  });

  test.for<ReviewEditsFlow>([
    { kind: 'idle' },
    { kind: 'busy', text: 'Staging…' },
    { kind: 'preview', plan: plan() },
    { kind: 'discard', loss: loss() },
  ])('keeps a $kind flow', (flow, { expect }) => {
    expect(clearReviewEditsStatus(flow)).toBe(flow);
  });
});

function plan(): ReviewEditsPlanView {
  return { sessionId: 's', branch: 'review/pr-1', headSha: 'h', digest: 'd', edits: [] };
}

function loss(): ReviewEditsDiscardView {
  return { sessionId: 's', branch: 'review/pr-1', digest: 'd', commits: 0, files: ['a.ts'] };
}
