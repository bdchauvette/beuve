import { describe, expect, it } from 'vitest';

import { describePullRequestState } from './describe-pull-request-state.ts';

describe('describePullRequestState', () => {
  it('shows drafts as Draft and folds merged', () => {
    expect(describePullRequestState({ state: 'open', isDraft: true }).label).toBe('Draft');
    expect(describePullRequestState({ state: 'open', isDraft: false })).toEqual({
      label: 'Open',
      tone: 'ok',
    });
    expect(describePullRequestState({ state: 'merged', isDraft: false }).label).toBe('Merged');
    expect(describePullRequestState({ state: 'closed', isDraft: true }).label).toBe('Closed');
  });
});
