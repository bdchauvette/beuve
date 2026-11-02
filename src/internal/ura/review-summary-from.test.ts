import { describe } from 'vitest';

import { reviewSummaryFrom } from './review-summary-from.ts';
import { createSampleArtifact } from './testing/create-sample-artifact.ts';
import { test } from './testing/test.ts';

function summaryWithoutItems(value: 'approve' | 'request-changes' | 'comment'): string {
  return reviewSummaryFrom({
    ...createSampleArtifact({ value, source: 'derived' }),
    entries: [],
  });
}

describe('reviewSummaryFrom', () => {
  test('tallies the items by severity, without naming the tool', ({ expect }) => {
    const summary = reviewSummaryFrom(createSampleArtifact());
    expect(summary).toBe('1 blocker, 1 issue, 1 question, 1 nit, 1 praise.');
    expect(summary).not.toContain('beuve');
  });

  test('names the verdict when there are no items', ({ expect }) => {
    expect(summaryWithoutItems('approve')).toBe('Approved');
    expect(summaryWithoutItems('request-changes')).toBe('Changes requested');
    expect(summaryWithoutItems('comment')).toBe('Comments');
  });
});
