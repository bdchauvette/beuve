import { describe } from 'vitest';

import { defaultReviewQueuePrefs } from '#contract/default-review-queue-prefs.ts';
import type { QueueFiltersView, ReviewQueueItemView } from '#contract/ipc-contract.ts';

import { filterQueueItems } from './filter-queue-items.ts';
import { createQueueItem } from './testing/create-queue-item.ts';
import { test } from './testing/test.ts';

function numbersOf(items: readonly ReviewQueueItemView[]): (number | string | undefined)[] {
  return items.map((item) => item.number ?? item.branch);
}

function sample(): ReviewQueueItemView[] {
  return [
    createQueueItem({ number: 1 }),
    createQueueItem({ number: 2, request: 'team', isDraft: true, author: 'rita' }),
    createQueueItem({
      number: 3,
      reasons: ['authored'],
      attention: { turn: 'reviewers', reasons: [] },
      author: 'me',
      ci: { overall: 'pending', failing: 0 },
    }),
    createQueueItem({
      number: 4,
      reasons: ['authored'],
      attention: { turn: 'you', reasons: ['CI is failing'] },
      author: 'me',
      ci: { overall: 'failure', failing: 2 },
    }),
    createQueueItem({
      key: 'github.com/o/tools:claude/fix',
      kind: 'branch',
      repo: 'tools',
      branch: 'claude/fix',
      title: 'Fix the login',
      reasons: ['branch'],
      local: { state: 'new-commits', sessionId: 's1' },
      ci: { overall: 'success', failing: 0 },
      number: undefined,
    }),
  ];
}

describe('filterQueueItems', () => {
  test('shows every requested review under the default filters, whatever its turn, draft state or CI', ({
    expect,
  }) => {
    const requested = createQueueItem({
      number: 9,
      request: 'team',
      isDraft: true,
      ci: { overall: 'failure', failing: 3 },
      attention: { turn: 'author', reasons: ['it is a draft', 'CI is failing (3 checks)'] },
      reasons: ['requested', 'authored'],
    });
    expect(
      filterQueueItems([requested], { filters: defaultReviewQueuePrefs.filters, text: '' }),
    ).toStrictEqual([requested]);
  });

  test('never lets a stack’s context row through on its own', ({ expect }) => {
    const context = createQueueItem({
      number: 9,
      reasons: [],
      isContext: true,
      attention: { turn: 'unknown', reasons: [] },
      stack: { id: 'github.com/o/r#9', depth: 0, position: 0, size: 2 },
    });
    const filters = { ...defaultReviewQueuePrefs.filters, showWaitingOnOthers: true };
    expect(filterQueueItems([context], { filters, text: '' })).toStrictEqual([]);
  });

  test.for<[string, Partial<QueueFiltersView>, string, (number | string | undefined)[]]>([
    ['the defaults hide only own pull requests waiting on others', {}, '', [1, 2, 4, 'claude/fix']],
    ['waiting on others shown', { showWaitingOnOthers: true }, '', [1, 2, 3, 4, 'claude/fix']],
    ['branches only', { kinds: ['branch'] }, '', ['claude/fix']],
    ['one repository', { repositories: ['GitHub.com/o/tools'] }, '', ['claude/fix']],
    ['one author', { authors: ['rita'] }, '', [2]],
    ['direct requests', { request: 'direct' }, '', [1]],
    ['team requests', { request: 'team' }, '', [2]],
    ['no drafts', { hideDrafts: true }, '', [1, 4, 'claude/fix']],
    ['failing CI', { ci: ['failure'] }, '', [4]],
    [
      'passing or pending CI',
      { ci: ['success', 'pending'], showWaitingOnOthers: true },
      '',
      [3, 'claude/fix'],
    ],
    ['your turn', { turns: ['you'] }, '', [1, 2, 4, 'claude/fix']],
    ['new commits since the review', { local: ['new-commits'] }, '', ['claude/fix']],
    ['free text over title and branch', {}, 'LOGIN claude', ['claude/fix']],
    ['free text over the number', {}, '#2', [2]],
  ])('%s', ([, change, text, expected], { expect }) => {
    const filters = { ...defaultReviewQueuePrefs.filters, ...change };
    const shown = filterQueueItems(sample(), { filters, text });
    expect(numbersOf(shown)).toStrictEqual(expected);
  });
});
