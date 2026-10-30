import { advanceHead } from './advance-head.ts';
import type { CommitSha, Session, SessionId } from './session.ts';
import { test } from './testing/test.ts';

test(
  'advanceHead moves the head and touches updatedAt',
  { concurrent: false },
  ({ expect, clock }) => {
    clock.set('2026-10-28T13:00:00Z');
    const next = 'b'.repeat(40) as CommitSha;
    expect(advanceHead(session(), next)).toStrictEqual({
      ...session(),
      headSha: next,
      updatedAt: '2026-10-28T13:00:00.000Z',
    });
  },
);

test('advanceHead returns the same session when the head is unchanged', ({ expect }) => {
  const unchanged = session();
  expect(advanceHead(unchanged, unchanged.headSha)).toBe(unchanged);
});

function session(): Session {
  return {
    id: '00000000-0000-4000-8000-000000000001' as SessionId,
    source: { kind: 'local', repoPath: '/repo', baseRef: 'main', headRef: 'feature' },
    headSha: 'a'.repeat(40) as CommitSha,
    review: { kind: 'unreviewed' },
    createdAt: '2026-10-28T12:00:00.000Z',
    updatedAt: '2026-10-28T12:00:00.000Z',
  };
}
