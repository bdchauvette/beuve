import type { DatabaseSync } from 'node:sqlite';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { createSession } from './create-session.ts';
import { findReviewRangeChoice } from './find-review-range-choice.ts';
import { insertCheckpoint } from './insert-checkpoint.ts';
import { insertSession } from './insert-session.ts';
import { recordCheckpoint } from './record-checkpoint.ts';
import { setReviewRangeChoice } from './set-review-range-choice.ts';
import type { Checkpoint, CommitSha, Session, SessionDeps, SessionId } from './session.ts';
import { test } from './testing/test.ts';

test('a session shows the range since its last checkpoint until the reviewer chooses another', ({
  expect,
  db,
  deps,
}) => {
  const session = storedSession(db, deps);
  expect(findReviewRangeChoice(db, session.id)).toStrictEqual({
    ok: true,
    value: { kind: 'since-last' },
  });
  okValueFrom(setReviewRangeChoice(db, session.id, { kind: 'whole' }));
  expect(findReviewRangeChoice(db, session.id)).toStrictEqual({
    ok: true,
    value: { kind: 'whole' },
  });
  okValueFrom(setReviewRangeChoice(db, session.id, { kind: 'since-last' }));
  expect(findReviewRangeChoice(db, session.id)).toStrictEqual({
    ok: true,
    value: { kind: 'since-last' },
  });
});

test('setReviewRangeChoice keeps a chosen checkpoint, which reads back whole', ({
  expect,
  db,
  deps,
}) => {
  const session = storedSession(db, deps);
  const checkpoint = saved(db, session, deps);
  okValueFrom(
    setReviewRangeChoice(db, session.id, { kind: 'since-checkpoint', checkpointId: checkpoint.id }),
  );
  expect(findReviewRangeChoice(db, session.id)).toStrictEqual({
    ok: true,
    value: { kind: 'since-checkpoint', checkpoint },
  });
});

test('setReviewRangeChoice refuses another session’s checkpoint and an unknown session', ({
  expect,
  db,
  deps,
}) => {
  const session = storedSession(db, deps);
  const other = storedSession(db, deps, 'other');
  const theirs = saved(db, other, deps);
  const unknown = '00000000-0000-4000-8000-0000000000ff' as SessionId;
  expect(
    setReviewRangeChoice(db, session.id, { kind: 'since-checkpoint', checkpointId: theirs.id }),
  ).toStrictEqual({ ok: false, error: { kind: 'checkpoint-not-found', checkpointId: theirs.id } });
  expect(setReviewRangeChoice(db, unknown, { kind: 'whole' })).toStrictEqual({
    ok: false,
    error: { kind: 'session-not-found', sessionId: unknown },
  });
});

test('saving progress puts the range back to the default', ({ expect, db, deps }) => {
  const session = storedSession(db, deps);
  okValueFrom(setReviewRangeChoice(db, session.id, { kind: 'whole' }));
  saved(db, session, deps);
  expect(findReviewRangeChoice(db, session.id)).toStrictEqual({
    ok: true,
    value: { kind: 'since-last' },
  });
});

test('findReviewRangeChoice reports a stored kind it does not know', ({ expect, db, deps }) => {
  const session = storedSession(db, deps);
  db.exec('PRAGMA ignore_check_constraints = ON;');
  db.prepare("INSERT INTO review_ranges (session_id, kind) VALUES (?, 'sideways');").run(
    session.id,
  );
  expect(findReviewRangeChoice(db, session.id)).toStrictEqual({
    ok: false,
    error: {
      kind: 'corrupt-row',
      table: 'review_ranges',
      id: session.id,
      reason: 'kind is not a review range',
    },
  });
});

function saved(db: DatabaseSync, session: Session, deps: SessionDeps): Checkpoint {
  const { checkpoint } = recordCheckpoint(session, { baseSha: sha('f'), headSha: sha('1') }, deps);
  okValueFrom(insertCheckpoint(db, checkpoint));
  return checkpoint;
}

function sha(digit: string): CommitSha {
  return digit.repeat(40) as CommitSha;
}

function storedSession(db: DatabaseSync, deps: SessionDeps, headRef = 'feat'): Session {
  const created = okValueFrom(
    createSession({ kind: 'local', repoPath: '/repo', baseRef: 'main', headRef }, sha('1'), deps),
  );
  insertSession(db, created);
  return created;
}
