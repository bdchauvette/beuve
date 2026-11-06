import { describe } from 'vitest';

import type { QueueSortView, ReviewQueueItemView } from '#contract/ipc-contract.ts';

import { sortQueueItems } from './sort-queue-items.ts';
import { createQueueItem } from './testing/create-queue-item.ts';
import { test } from './testing/test.ts';

function sample(): ReviewQueueItemView[] {
  return [
    createQueueItem({
      number: 1,
      attention: { turn: 'author', reasons: [] },
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-10-05T00:00:00Z',
      waitingSince: '2026-10-05T00:00:00Z',
      size: { additions: 500, deletions: 10, changedFiles: 9 },
      local: { state: 'reviewed' },
    }),
    createQueueItem({
      number: 2,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-03T00:00:00Z',
      waitingSince: '2026-10-03T00:00:00Z',
      size: { additions: 5, deletions: 1, changedFiles: 1 },
      stack: { id: 'github.com/o/r#4', depth: 1, size: 2 },
      local: { state: 'partial' },
    }),
    createQueueItem({
      number: 3,
      createdAt: '2026-10-02T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00+02:00',
      waitingSince: '2026-10-01T00:00:00+02:00',
      local: { state: 'new-commits' },
    }),
    createQueueItem({
      number: 4,
      attention: { turn: 'reviewers', reasons: [] },
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-10-04T00:00:00Z',
      waitingSince: '2026-10-04T00:00:00Z',
      size: { additions: 50, deletions: 50, changedFiles: 3 },
      stack: { id: 'github.com/o/r#4', depth: 0, size: 2 },
    }),
  ];
}

describe('sortQueueItems', () => {
  test.for<[QueueSortView, number[]]>([
    ['turn', [3, 2, 4, 1]],
    ['waiting', [3, 2, 4, 1]],
    ['oldest', [4, 1, 2, 3]],
    ['updated', [1, 4, 2, 3]],
    ['smallest', [2, 4, 1, 3]],
    ['largest', [1, 4, 2, 3]],
    ['stack', [3, 4, 2, 1]],
    ['new-since-review', [3, 2, 4, 1]],
  ])('%s', ([sort, expected], { expect }) => {
    const sorted = sortQueueItems(sample(), sort);
    expect(sorted.map((item) => item.number)).toStrictEqual(expected);
  });

  test('breaks ties on the repository and then the number, whatever the input order', ({
    expect,
  }) => {
    const same = {
      waitingSince: '2026-10-01T00:00:00Z',
      attention: { turn: 'you', reasons: [] },
    } as const;
    const items = [
      createQueueItem({ ...same, number: 2, repo: 'b', key: 'github.com/o/b#2' }),
      createQueueItem({ ...same, number: 9, repo: 'a', key: 'github.com/o/a#9' }),
      createQueueItem({ ...same, number: 1, repo: 'b', key: 'github.com/o/b#1' }),
    ];
    const keys = sortQueueItems(items, 'turn').map((item) => item.key);
    expect(keys).toStrictEqual(['github.com/o/a#9', 'github.com/o/b#1', 'github.com/o/b#2']);
    expect(sortQueueItems(items.toReversed(), 'turn').map((item) => item.key)).toStrictEqual(keys);
  });
});
