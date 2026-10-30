import { okValueFrom } from '#testing/ok-value-from.ts';
import { isUuid } from '#x/text/is-uuid.ts';
import { isIsoTimestamp } from '#x/time/is-iso-timestamp.ts';

import { createSession } from './create-session.ts';
import type { CommitSha, SessionSource } from './session.ts';
import { test } from './testing/test.ts';

test(
  'createSession starts unreviewed at the given head',
  { concurrent: false },
  ({ expect, clock, deps }) => {
    clock.set('2026-10-28T12:00:00Z');
    const source = local('feature');
    expect(createSession(source, head(), deps)).toStrictEqual({
      ok: true,
      value: {
        id: '00000000-0000-4000-8000-000000000001',
        source,
        headSha: head(),
        review: { kind: 'unreviewed' },
        createdAt: '2026-10-28T12:00:00.000Z',
        updatedAt: '2026-10-28T12:00:00.000Z',
      },
    });
  },
);

test('createSession rejects an invalid source', ({ expect, deps }) => {
  const source = { ...local('x'), repoPath: 'repo' };
  expect(createSession(source, head(), deps)).toMatchObject({
    ok: false,
    error: { kind: 'invalid-source' },
  });
});

test('createSession reads the system clock and uses randomUUID by default', ({ expect }) => {
  const created = okValueFrom(createSession(local('x'), head()));
  expect(isUuid(created.id)).toBe(true);
  expect(isIsoTimestamp(created.createdAt)).toBe(true);
});

function head(): CommitSha {
  return 'a'.repeat(40) as CommitSha;
}

function local(headRef: string): SessionSource {
  return { kind: 'local', repoPath: '/repo', baseRef: 'main', headRef };
}
