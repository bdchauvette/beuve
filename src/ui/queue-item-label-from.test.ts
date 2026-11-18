import { describe } from 'vitest';

import { queueItemLabelFrom } from './queue-item-label-from.ts';
import { createQueueItem } from './testing/create-queue-item.ts';
import { test } from './testing/test.ts';

describe('queueItemLabelFrom', () => {
  test('names a pull request by repository, number and title', ({ expect }) => {
    expect(queueItemLabelFrom(createQueueItem({ number: 12, title: 'Fix it' }))).toBe(
      'o/r#12 Fix it',
    );
  });

  test('names a branch by repository and branch', ({ expect }) => {
    const item = createQueueItem({ kind: 'branch', number: undefined, branch: 'claude/x' });
    expect(queueItemLabelFrom(item)).toBe('o/r:claude/x');
  });

  test('falls back to the title when an item has neither', ({ expect }) => {
    const item = createQueueItem({ kind: 'branch', number: undefined, title: 'Tip' });
    expect(queueItemLabelFrom(item)).toBe('o/r Tip');
  });
});
