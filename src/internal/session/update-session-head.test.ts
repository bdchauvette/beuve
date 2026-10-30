import type { CommitSha, Session, SessionId } from './session.ts';
import { test } from './testing/test.ts';
import { updateSessionHead } from './update-session-head.ts';

test('updateSessionHead reports an unknown session', ({ expect, db }) => {
  const session: Session = {
    id: '00000000-0000-4000-8000-000000000001' as SessionId,
    source: { kind: 'local', repoPath: '/repo', baseRef: 'main', headRef: 'feat' },
    headSha: 'a'.repeat(40) as CommitSha,
    review: { kind: 'unreviewed' },
    createdAt: '2026-10-28T12:00:00.000Z',
    updatedAt: '2026-10-28T12:00:00.000Z',
  };
  expect(updateSessionHead(db, session)).toStrictEqual({
    ok: false,
    error: { kind: 'session-not-found', sessionId: session.id },
  });
});
