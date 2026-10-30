import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { describePullRequestState } from './describe-pull-request-state.ts';

describe('describePullRequestState', () => {
  test('shows drafts as Draft and folds merged', ({ expect }) => {
    expect(describePullRequestState({ state: 'open', isDraft: true }).label).toBe('Draft');
    expect(describePullRequestState({ state: 'open', isDraft: false })).toStrictEqual({
      label: 'Open',
      tone: 'ok',
    });
    expect(describePullRequestState({ state: 'merged', isDraft: false }).label).toBe('Merged');
    expect(describePullRequestState({ state: 'closed', isDraft: true }).label).toBe('Closed');
  });
});
