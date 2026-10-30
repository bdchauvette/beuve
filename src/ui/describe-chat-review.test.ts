import { describe, expect, it } from 'vitest';

import type { ChatReviewView } from '#contract/ipc-contract.ts';

import { describeChatReview } from './describe-chat-review.ts';

const review: ChatReviewView = {
  findings: [
    {
      path: 'src/a.ts',
      startLine: 12,
      endLine: 12,
      severity: 'risk',
      category: 'error-handling',
      title: 'Swallowed error',
      body: 'The catch drops it.',
      confidence: 0.834,
      check: 'confirmed',
    },
    {
      path: 'src/b.ts',
      startLine: 3,
      endLine: 9,
      severity: 'info',
      category: 'scope-creep',
      title: 'Unrelated rename',
      body: '',
      confidence: 0.5,
      check: 'unconfirmed',
    },
  ],
  dropped: {
    unknownFile: 1,
    outsideDiff: 1,
    lowConfidence: 1,
    duplicate: 0,
    overLimit: 0,
    unconfirmed: 2,
  },
  pathScope: [],
  fileCount: 3,
  verification: 'verified',
};

describe('describeChatReview', () => {
  it('sums up files, findings and drops, and labels each finding', () => {
    const labels = describeChatReview(review);
    expect(labels.summary).toBe(
      '3 files · 2 findings · 2 dropped as unconfirmed · 2 off the diff · 1 below the bar',
    );
    expect(labels.note).toBeUndefined();
    expect(labels.findings).toEqual([
      {
        severity: 'Risk',
        category: 'error handling',
        confidence: '83%',
        check: 'confirmed',
        checkTitle: expect.stringContaining('confirmed it') as string,
        where: 'src/a.ts:12',
      },
      {
        severity: 'Info',
        category: 'scope creep',
        confidence: '50%',
        check: 'unconfirmed',
        checkTitle: expect.stringContaining('neither confirm nor refute') as string,
        where: 'src/b.ts:3-9',
      },
    ]);
  });

  it('keeps the line short for a clean review and notes reuse or a failed check', () => {
    const clean = {
      ...review,
      findings: [],
      fileCount: 1,
      dropped: {
        ...review.dropped,
        unknownFile: 0,
        outsideDiff: 0,
        lowConfidence: 0,
        unconfirmed: 0,
      },
    };
    expect(describeChatReview(clean).summary).toBe('1 file · 0 findings');
    expect(describeChatReview({ ...clean, reusedFrom: 'm1' }).note).toContain('--fresh');
    expect(describeChatReview({ ...clean, verification: 'failed' }).note).toContain('unchecked');
  });
});
