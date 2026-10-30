import { advanceHead } from './advance-head.ts';
import { createSession } from './create-session.ts';
import { findSession } from './find-session.ts';
import { insertSession } from './insert-session.ts';
import type { CommitSha, Session, SessionId } from './session.ts';
import { test } from './testing/test.ts';
import { updateSessionHead } from './update-session-head.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

test('updateSessionHead reports an unknown session', ({ expect, db }) => {
  const session: Session = {
    id: '00000000-0000-4000-8000-000000000001' as SessionId,
    source: { kind: 'local', repoPath: '/repo', baseRef: 'main', headRef: 'feat' },
    headSha: 'a'.repeat(40) as CommitSha,
    review: { kind: 'unreviewed' },
    createdAt: '2026-10-28T12:00:00.000Z',
    updatedAt: '2026-10-28T12:00:00.000Z',
  };
  expect(updateSessionHead(db, session, sha('0'))).toStrictEqual({
    ok: false,
    error: { kind: 'session-not-found', sessionId: session.id },
  });
});

test('updateSessionHead moves the head only from the head the writer read', ({
  expect,
  db,
  deps,
}) => {
  const stored = okValueFrom(
    createSession(
      { kind: 'local', repoPath: '/repo', baseRef: 'main', headRef: 'feat' },
      sha('1'),
      deps,
    ),
  );
  okValueFrom(insertSession(db, stored));
  const faster = advanceHead(stored, sha('3'));
  expect(updateSessionHead(db, faster, sha('1'))).toStrictEqual({ ok: true, value: undefined });
  const slower = advanceHead(stored, sha('2'));
  expect(updateSessionHead(db, slower, sha('1'))).toStrictEqual({
    ok: false,
    error: { kind: 'head-changed', sessionId: stored.id, expected: sha('1'), stored: sha('3') },
  });
  expect(okValueFrom(findSession(db, stored.id))?.headSha).toBe(sha('3'));
});

function sha(digit: string): CommitSha {
  return digit.repeat(40) as CommitSha;
}
