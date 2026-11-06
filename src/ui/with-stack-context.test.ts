import { describe } from 'vitest';

import type { ReviewQueueItemView } from '#contract/ipc-contract.ts';

import { createQueueItem } from './testing/create-queue-item.ts';
import { test } from './testing/test.ts';
import { withStackContext } from './with-stack-context.ts';

function stacked(number: number, id: string): ReviewQueueItemView {
  return createQueueItem({ number, stack: { id, depth: 0, position: number, size: 2 } });
}

describe('withStackContext', () => {
  test('adds the rest of each matched item’s stack, after the matched items', ({ expect }) => {
    const all = [
      stacked(1, 'a'),
      stacked(2, 'a'),
      stacked(3, 'b'),
      stacked(4, 'b'),
      createQueueItem({ number: 5 }),
      createQueueItem({ number: 6 }),
    ];
    const matched = [all[1], all[4]].filter((item) => item !== undefined);
    const shown = withStackContext({ all, matched });
    expect(shown.map((item) => item.number)).toStrictEqual([2, 5, 1]);
  });
});
