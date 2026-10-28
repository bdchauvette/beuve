import { describe, expect, it } from 'vitest';

import { advanceReviewEntry } from './advance-review-entry.ts';
import type { ReviewChatEntry } from './chat-entry.ts';

const entry: ReviewChatEntry = {
  id: 1,
  kind: 'review',
  sessionId: 's1',
  runId: 'r1',
  status: 'running',
  citations: [],
};
const ids = { runId: 'r1', sessionId: 's1', headSha: 'a'.repeat(40) };
const summary = {
  reviewRunId: 'rr',
  sessionId: 's1',
  headSha: ids.headSha,
  scope: 'full' as const,
  model: 'm',
  insightCount: 1,
  droppedCount: 0,
  createdAt: '2026-10-28T00:00:00.000Z',
};

describe('advanceReviewEntry', () => {
  it('follows progress to completion, then ignores later events', () => {
    const progressed = advanceReviewEntry(entry, { ...ids, kind: 'progress', message: 'Reading' });
    expect(progressed).toMatchObject({ status: 'running', progress: 'Reading' });
    const done = advanceReviewEntry(progressed, { ...ids, kind: 'completed', summary });
    expect(done).toMatchObject({ status: 'completed', summary });
    expect(advanceReviewEntry(done, { ...ids, kind: 'progress', message: 'late' })).toBe(done);
  });

  it('records failures and ignores other runs', () => {
    const error = { code: 'not-installed' as const, message: 'no claude' };
    expect(advanceReviewEntry(entry, { ...ids, kind: 'failed', error })).toMatchObject({
      status: 'failed',
      error,
    });
    expect(advanceReviewEntry(entry, { ...ids, runId: 'r2', kind: 'started' })).toBe(entry);
  });
});
