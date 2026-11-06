import { describe } from 'vitest';

import type { QueueLocalReviewView } from '#contract/ipc-contract.ts';

import { describeLocalReview } from './describe-local-review.ts';
import { test } from './testing/test.ts';

describe('describeLocalReview', () => {
  test.for<[QueueLocalReviewView, string, string]>([
    [{ state: 'none' }, 'New', 'accent'],
    [{ state: 'opened', markedFiles: 0 }, 'Opened', 'muted'],
    [{ state: 'partial', markedFiles: 1 }, 'In progress', 'warn'],
    [{ state: 'reviewed' }, 'Reviewed', 'ok'],
    [{ state: 'new-commits' }, 'New commits', 'warn'],
  ])('%o', ([local, text, tone], { expect }) => {
    expect(describeLocalReview(local)).toMatchObject({ text, tone });
  });

  test('counts the marked files', ({ expect }) => {
    expect(describeLocalReview({ state: 'partial', markedFiles: 3 }).title).toBe(
      '3 files marked reviewed, no checkpoint yet',
    );
    expect(describeLocalReview({ state: 'partial', markedFiles: 1 }).title).toBe(
      '1 file marked reviewed, no checkpoint yet',
    );
  });
});
