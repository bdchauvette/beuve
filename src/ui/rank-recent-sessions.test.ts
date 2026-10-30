import { describe } from 'vitest';

import { test } from './testing/test.ts';

import type { SessionSummary } from '#contract/ipc-contract.ts';

import { rankRecentSessions } from './rank-recent-sessions.ts';

function local(): SessionSummary {
  return {
    id: 'l',
    source: { kind: 'local', repoPath: '/code/beuve', baseRef: 'main', headRef: 'layout' },
    headSha: 'a'.repeat(40),
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-02T00:00:00Z',
  };
}
function pull(id: string, repoPath: string, updatedAt: string): SessionSummary {
  return {
    id,
    source: {
      kind: 'github-pull-request',
      repoPath,
      baseRef: 'refs/beuve/pr/7/base',
      host: 'github.com',
      owner: 'Octo-Org',
      repo: 'hello',
      number: 7,
    },
    headSha: 'b'.repeat(40),
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt,
    pullRequest: { title: 'Add tax to totals', state: 'open', isDraft: false, baseBranch: 'main' },
  };
}

describe('rankRecentSessions', () => {
  test('orders by last update and filters on every word', ({ expect }) => {
    const sessions = [local(), pull('p', '/code/hello', '2026-10-03T00:00:00Z')];
    expect(rankRecentSessions(sessions, '').map((s) => s.id)).toStrictEqual(['p', 'l']);
    expect(rankRecentSessions(sessions, 'TAX hello').map((s) => s.id)).toStrictEqual(['p']);
    expect(rankRecentSessions(sessions, 'layout').map((s) => s.id)).toStrictEqual(['l']);
    expect(rankRecentSessions(sessions, 'nothing')).toStrictEqual([]);
  });
});
