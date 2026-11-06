import { describe } from 'vitest';

import type { QueueGroupView, ReviewQueueItemView } from '#contract/ipc-contract.ts';

import { groupQueueItems } from './group-queue-items.ts';
import { createQueueItem } from './testing/create-queue-item.ts';
import { test } from './testing/test.ts';

function sample(): ReviewQueueItemView[] {
  return [
    createQueueItem({ number: 1, repo: 'web', key: 'github.com/o/web#1' }),
    createQueueItem({
      number: 2,
      title: 'Base',
      attention: { turn: 'author', reasons: [] },
      stack: { id: 'github.com/o/r#2', depth: 0, size: 2 },
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
      stack: { id: 'github.com/o/r#2', depth: 1, size: 2 },
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
