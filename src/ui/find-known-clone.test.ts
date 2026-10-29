import { describe, expect, it } from 'vitest';

import type { SessionSummary } from '#contract/ipc-contract.ts';

import { findKnownClone } from './find-known-clone.ts';

const local: SessionSummary = {
  id: 'l',
  source: { kind: 'local', repoPath: '/code/beuve', baseRef: 'main', headRef: 'layout' },
  headSha: 'a'.repeat(40),
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-02T00:00:00Z',
};
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

describe('findKnownClone', () => {
  it('uses the most recent pull request session of the same repository', () => {
    const sessions = [
      local,
      pull('old', '/old/hello', '2026-10-01T00:00:00Z'),
      pull('new', '/new/hello', '2026-10-05T00:00:00Z'),
    ];
    expect(findKnownClone(sessions, { host: 'github.com', owner: 'octo-org', repo: 'HELLO' })).toBe(
      '/new/hello',
    );
    expect(findKnownClone(sessions, { host: 'github.com', owner: 'x', repo: 'y' })).toBeUndefined();
  });
});
