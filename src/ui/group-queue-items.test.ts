import { describe } from 'vitest';

import { defaultReviewQueuePrefs } from '#contract/default-review-queue-prefs.ts';
import type { QueueGroupView, ReviewQueueItemView } from '#contract/ipc-contract.ts';

import { filterQueueItems } from './filter-queue-items.ts';
import { groupQueueItems } from './group-queue-items.ts';
import { sortQueueItems } from './sort-queue-items.ts';
import { createQueueItem } from './testing/create-queue-item.ts';
import { test } from './testing/test.ts';
import { withStackContext } from './with-stack-context.ts';

function sample(): ReviewQueueItemView[] {
  return [
    createQueueItem({ number: 1, repo: 'web', key: 'github.com/o/web#1' }),
    createQueueItem({
      number: 2,
      title: 'Base',
      attention: { turn: 'author', reasons: [] },
      stack: { id: 'github.com/o/r#2', depth: 0, size: 2, position: 0 },
      local: { state: 'new-commits' },
    }),
    createQueueItem({
      key: 'ghe.example/t/tools:claude/x',
      kind: 'branch',
      host: 'ghe.example',
      owner: 't',
      repo: 'tools',
      branch: 'claude/x',
      number: undefined,
      reasons: ['branch'],
    }),
    createQueueItem({
      number: 3,
      stack: { id: 'github.com/o/r#2', depth: 1, size: 2, position: 1 },
      local: { state: 'reviewed' },
    }),
  ];
}

function headingsOf(groups: ReturnType<typeof groupQueueItems>): string[] {
  return groups.map((group) => {
    const members = group.items.map((item) => item.number ?? item.branch).join(',');
    return `${group.label}: ${members}`;
  });
}

describe('groupQueueItems', () => {
  test.for<[QueueGroupView, string[]]>([
    ['none', [': 1,2,claude/x,3']],
    ['repository', ['ghe.example/t/tools: claude/x', 'o/r: 2,3', 'o/web: 1']],
    ['stack', ['Stack on #2 Base: 2,3', 'Not stacked: 1,claude/x']],
    ['turn', ['Your turn: 1,claude/x,3', 'Author’s turn: 2']],
    ['kind', ['Pull requests: 1,2,3', 'Branches: claude/x']],
    [
      'local',
      ['New commits since your review: 2', 'Not opened: 1,claude/x', 'Reviewed and up to date: 3'],
    ],
  ])('by %s', ([group, expected], { expect }) => {
    const groups = groupQueueItems(sample(), group);
    expect(headingsOf(groups)).toStrictEqual(expected);
  });
});

/** Where a member sits in the stack on #1, and whether it is only context. */
interface StackPlace {
  readonly depth: number;
  readonly position: number;
  readonly size: number;
  readonly isContext?: boolean;
}

/** Pull request `number` in the stack on #1, queued unless `isContext`. */
function member(number: number, place: StackPlace): ReviewQueueItemView {
  const { depth, position, size } = place;
  if (place.isContext === true) {
    return createQueueItem({
      number,
      stack: { id: 'github.com/o/r#1', depth, position, size },
      isContext: true,
      reasons: [],
      attention: { turn: 'unknown', reasons: [] },
    });
  }
  return createQueueItem({ number, stack: { id: 'github.com/o/r#1', depth, position, size } });
}

/** The headings and rows the queue view shows when grouping by stack. */
function stackGroups(items: readonly ReviewQueueItemView[]): string[] {
  const matched = filterQueueItems(items, { filters: defaultReviewQueuePrefs.filters, text: '' });
  const shown = withStackContext({ all: items, matched });
  return headingsOf(groupQueueItems(sortQueueItems(shown, 'turn'), 'stack'));
}

/** The item as the viewer's own pull request waiting on its reviewers. */
function waitingOnOthers(item: ReviewQueueItemView): ReviewQueueItemView {
  return { ...item, reasons: ['authored'], attention: { turn: 'reviewers', reasons: [] } };
}

describe('groupQueueItems by whole stacks', () => {
  test('a stack whose middle is not waiting on the viewer stays one group of three', ({
    expect,
  }) => {
    const items = [
      member(3, { depth: 2, position: 2, size: 3 }),
      member(1, { depth: 0, position: 0, size: 3 }),
      member(2, { depth: 1, position: 1, size: 3, isContext: true }),
      createQueueItem({ number: 9 }),
    ];
    expect(stackGroups(items)).toStrictEqual(['Stack on #1 Change 1: 1,2,3', 'Not stacked: 9']);
  });

  test('a branching stack lists each pull request before those based on it', ({ expect }) => {
    const items = [
      member(4, { depth: 1, position: 3, size: 4 }),
      member(5, { depth: 2, position: 2, size: 4 }),
      member(1, { depth: 0, position: 0, size: 4, isContext: true }),
      member(3, { depth: 1, position: 1, size: 4, isContext: true }),
    ];
    expect(stackGroups(items)).toStrictEqual(['Stack on #1 Change 1: 1,3,5,4']);
  });

  test('a stack where only the top is queued shows whole', ({ expect }) => {
    const items = [
      member(1, { depth: 0, position: 0, size: 3, isContext: true }),
      member(2, { depth: 1, position: 1, size: 3, isContext: true }),
      member(3, { depth: 2, position: 2, size: 3 }),
    ];
    expect(stackGroups(items)).toStrictEqual(['Stack on #1 Change 1: 1,2,3']);
  });

  test('a stack whose queued members the filters all hide disappears whole', ({ expect }) => {
    const items = [
      member(1, { depth: 0, position: 0, size: 2, isContext: true }),
      waitingOnOthers(member(2, { depth: 1, position: 1, size: 2 })),
    ];
    expect(stackGroups(items)).toStrictEqual([]);
  });

  test('a queued member the filters hide still shows within a stack that shows', ({ expect }) => {
    const items = [
      member(1, { depth: 0, position: 0, size: 2 }),
      waitingOnOthers(member(2, { depth: 1, position: 1, size: 2 })),
    ];
    expect(stackGroups(items)).toStrictEqual(['Stack on #1 Change 1: 1,2']);
  });
});
