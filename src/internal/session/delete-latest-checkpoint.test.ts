import type { DatabaseSync } from 'node:sqlite';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { createSession } from './create-session.ts';
import { deleteLatestCheckpoint } from './delete-latest-checkpoint.ts';
import { findReviewRangeChoice } from './find-review-range-choice.ts';
import { findSession } from './find-session.ts';
import { insertCheckpoint } from './insert-checkpoint.ts';
import { insertSession } from './insert-session.ts';
import { listCheckpoints } from './list-checkpoints.ts';
import { recordCheckpoint } from './record-checkpoint.ts';
import { setReviewRangeChoice } from './set-review-range-choice.ts';
import type { Checkpoint, CheckpointId, CommitSha, Session, SessionDeps } from './session.ts';
import { test } from './testing/test.ts';

test('deleteLatestCheckpoint undoes the latest save, so the one before it is the review state', ({
  expect,
  db,
  deps,
}) => {
  const session = storedSession(db, deps);
  const first = saved(db, { session, headSha: sha('1') }, deps);
  const second = saved(db, { session, headSha: sha('2') }, deps);
  expect(deleteLatestCheckpoint(db, session.id, second.id)).toStrictEqual({
    ok: true,
    value: undefined,
  });
  expect(okValueFrom(findSession(db, session.id))?.review).toStrictEqual({
    kind: 'reviewed',
    checkpoint: first,
  });
  expect(deleteLatestCheckpoint(db, session.id, first.id)).toStrictEqual({
    ok: true,
    value: undefined,
  });
  expect(okValueFrom(findSession(db, session.id))?.review).toStrictEqual({ kind: 'unreviewed' });
});

test('deleteLatestCheckpoint refuses a checkpoint a later save superseded', ({
  expect,
  db,
  deps,
}) => {
  const session = storedSession(db, deps);
  const first = saved(db, { session, headSha: sha('1') }, deps);
  const second = saved(db, { session, headSha: sha('2') }, deps);
  expect(deleteLatestCheckpoint(db, session.id, first.id)).toStrictEqual({
    ok: false,
    error: { kind: 'checkpoint-superseded', checkpointId: first.id },
  });
  expect(listCheckpoints(db, session.id)).toStrictEqual({ ok: true, value: [first, second] });
});

test('deleteLatestCheckpoint reports a checkpoint that is not the session’s', ({
  expect,
  db,
  deps,
}) => {
  const session = storedSession(db, deps);
  const other = storedSession(db, deps, 'other');
  const theirs = saved(db, { session: other, headSha: sha('1') }, deps);
  const missing = '00000000-0000-4000-8000-0000000000ee' as CheckpointId;
  expect(deleteLatestCheckpoint(db, session.id, theirs.id)).toStrictEqual({
    ok: false,
    error: { kind: 'checkpoint-not-found', checkpointId: theirs.id },
  });
  expect(deleteLatestCheckpoint(db, session.id, missing)).toStrictEqual({
    ok: false,
    error: { kind: 'checkpoint-not-found', checkpointId: missing },
  });
  expect(listCheckpoints(db, other.id)).toStrictEqual({ ok: true, value: [theirs] });
});

test('deleteLatestCheckpoint takes a range choice that names it with it', ({
  expect,
  db,
  deps,
}) => {
  const session = storedSession(db, deps);
  const first = saved(db, { session, headSha: sha('1') }, deps);
  okValueFrom(
    setReviewRangeChoice(db, session.id, { kind: 'since-checkpoint', checkpointId: first.id }),
  );
  okValueFrom(deleteLatestCheckpoint(db, session.id, first.id));
  expect(findReviewRangeChoice(db, session.id)).toStrictEqual({
    ok: true,
    value: { kind: 'since-last' },
  });
});

/** A save of `headSha` on `session`. */
interface Save {
  readonly session: Session;
  readonly headSha: CommitSha;
}

function saved(db: DatabaseSync, { session, headSha }: Save, deps: SessionDeps): Checkpoint {
  const { checkpoint } = recordCheckpoint(session, { baseSha: sha('f'), headSha }, deps);
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
