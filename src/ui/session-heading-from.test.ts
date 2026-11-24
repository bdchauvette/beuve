import { describe } from 'vitest';

import type { SessionSummary } from '#contract/ipc-contract.ts';

import { sessionHeadingFrom } from './session-heading-from.ts';
import { test } from './testing/test.ts';

describe('sessionHeadingFrom', () => {
  test('is undefined with no review open', ({ expect }) => {
    expect(sessionHeadingFrom([local()], '', undefined)).toBeUndefined();
  });

  test('parts a pull request into its repository, number and title', ({ expect }) => {
    const titled = {
      ...pull(),
      pullRequest: { title: 'Fix it', state: 'open', isDraft: false, baseBranch: 'main' },
    };
    expect(sessionHeadingFrom([titled as SessionSummary], 's2', undefined)).toStrictEqual({
      context: 'acme/checkout',
      number: '#42',
      name: 'Fix it',
      isBranch: false,
    });
    expect(sessionHeadingFrom([pull()], 's2', undefined)?.name).toBe('');
  });

  test('names a local review by its folder and head branch', ({ expect }) => {
    expect(sessionHeadingFrom([], 's1', local())).toStrictEqual({
      context: 'notes',
      name: 'feature',
      isBranch: true,
    });
  });
});

function local(): SessionSummary {
  return {
    id: 's1',
    source: {
      kind: 'local',
      repoPath: '/work/notes/',
      baseRef: 'main',
      headRef: 'refs/heads/feature',
    },
    headSha: 'a',
    createdAt: '2026-10-29T00:00:00Z',
    updatedAt: '2026-10-29T00:00:00Z',
  };
}

function pull(): SessionSummary {
  return {
    id: 's2',
    source: {
      kind: 'github-pull-request',
      repoPath: '/work/checkout',
      baseRef: 'refs/beuve/pr/42/base',
      host: 'github.com',
      owner: 'acme',
      repo: 'checkout',
      number: 42,
    },
    headSha: 'b',
    createdAt: '2026-10-29T00:00:00Z',
    updatedAt: '2026-10-29T00:00:00Z',
  };
}
