import { describe } from 'vitest';

import { test } from './testing/test.ts';

import type { SessionSummary } from '#contract/ipc-contract.ts';

import { describeSessionLabel } from './describe-session-label.ts';

function local(): SessionSummary {
  return {
    id: 's1',
    source: { kind: 'local', repoPath: '/work/notes/', baseRef: 'main', headRef: 'feature' },
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

describe('describeSessionLabel', () => {
  test('asks to open a review when none is selected', ({ expect }) => {
    expect(describeSessionLabel([local()], '', undefined)).toBe('Open a review…');
  });

  test('names a local session by folder, head and base', ({ expect }) => {
    expect(describeSessionLabel([local()], 's1', undefined)).toBe('notes · feature against main');
  });

  test('prefers the listed summary, which carries the pull request title', ({ expect }) => {
    const listed = {
      ...pull(),
      pullRequest: { title: 'Charge tax', state: 'open', isDraft: false, baseBranch: 'main' },
    } as const;
    expect(describeSessionLabel([listed], 's2', pull())).toBe('acme/checkout#42 Charge tax');
  });

  test('names a session opened before the session list caught up', ({ expect }) => {
    expect(describeSessionLabel([], 's2', pull())).toBe('acme/checkout#42');
    expect(describeSessionLabel([local()], 's2', pull())).toBe('acme/checkout#42');
  });

  test('ignores a review left over from another session', ({ expect }) => {
    expect(describeSessionLabel([], 's1', pull())).toBe('Open a review…');
  });
});
