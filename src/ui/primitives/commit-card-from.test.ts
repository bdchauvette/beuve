import { describe } from 'vitest';

import type { CommitInfoView } from '#contract/ipc-contract.ts';

import { commitCardFrom } from './commit-card-from.ts';
import { test } from '../testing/test.ts';

describe('commitCardFrom', () => {
  test('leaves the committer out when the author committed it straight away', ({ expect }) => {
    const card = commitCardFrom(info({}), 7);
    expect(card).toStrictEqual({
      subject: 'Tidy totals',
      body: '',
      author: info({}).author,
      parents: 'Parent 1111111',
    });
  });

  test('shows the committer when someone else committed it, or it was committed later', ({
    expect,
  }) => {
    const other = { name: 'Bo', email: 'bo@example.com', at: '2026-11-06T13:00:30Z' };
    expect(commitCardFrom(info({ committer: other }), 7).committer).toStrictEqual(other);
    const later = { ...info({}).author, at: '2026-11-07T09:00:00Z' };
    expect(commitCardFrom(info({ committer: later }), 7).committer).toStrictEqual(later);
  });

  test('says a commit with no parent is a root and one with two is a merge', ({ expect }) => {
    expect(commitCardFrom(info({ parents: [] }), 7).parents).toBe('Root commit');
    const merge = info({ parents: ['1'.repeat(40), '2'.repeat(40)] });
    expect(commitCardFrom(merge, 7).parents).toBe('Merge of 1111111 and 2222222');
  });
});

function info(overrides: Partial<CommitInfoView>): CommitInfoView {
  const author = { name: 'Ada', email: 'ada@example.com', at: '2026-11-06T13:00:00Z' };
  return {
    sha: 'a'.repeat(40),
    parents: ['1'.repeat(40)],
    author,
    committer: author,
    subject: 'Tidy totals',
    body: '',
    ...overrides,
  };
}
