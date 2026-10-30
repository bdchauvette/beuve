import type { DatabaseSync } from 'node:sqlite';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { advanceHead } from './advance-head.ts';
import { computeReviewRange } from './compute-review-range.ts';
import { createSession } from './create-session.ts';
import { findSession } from './find-session.ts';
import { insertCheckpoint } from './insert-checkpoint.ts';
import { insertSession } from './insert-session.ts';
import { listCheckpoints } from './list-checkpoints.ts';
import { recordCheckpoint } from './record-checkpoint.ts';
import type { CheckpointId, CommitSha, Session, SessionDeps, SessionId } from './session.ts';
import { countingSessionDeps } from './testing/counting-session-deps.ts';
import { test } from './testing/test.ts';
import { updateSessionHead } from './update-session-head.ts';

test('insertCheckpoint persists the checkpoint so the stored review state matches the pure one', ({
  expect,
  db,
  deps,
}) => {
  const session = storedSession(db, deps);
  const { session: reviewed, checkpoint } = recordCheckpoint(
    session,
    { baseSha: sha('f'), headSha: sha('1') },
    deps,
  );
  expect(insertCheckpoint(db, checkpoint)).toStrictEqual({ ok: true, value: undefined });
  expect(findSession(db, session.id)).toStrictEqual({ ok: true, value: reviewed });
  expect(listCheckpoints(db, session.id)).toStrictEqual({ ok: true, value: [checkpoint] });
});

test(
  'insertCheckpoint drives the Rev 1 to Rev 2 interdiff across reloads',
  { concurrent: false },
  ({ expect, clock, db, deps }) => {
    const session = storedSession(db, deps);
    clock.advance({ minutes: 1 });
    const first = recordCheckpoint(session, { baseSha: sha('f'), headSha: sha('1') }, deps);
    insertCheckpoint(db, first.checkpoint);
    clock.advance({ minutes: 1 });
    const pushed = advanceHead(first.session, sha('2'));
    expect(updateSessionHead(db, pushed)).toStrictEqual({ ok: true, value: undefined });
    expect(computeReviewRange(reload(db, session.id))).toStrictEqual({
      kind: 'interdiff',
      baseRef: 'main',
      fromBaseSha: sha('f'),
      fromHeadSha: sha('1'),
      toHeadSha: sha('2'),
    });

    clock.advance({ minutes: 1 });
    const second = recordCheckpoint(pushed, { baseSha: sha('f'), headSha: sha('2') }, deps);
    insertCheckpoint(db, second.checkpoint);
    expect(computeReviewRange(reload(db, session.id))).toStrictEqual({
      kind: 'up-to-date',
      headSha: sha('2'),
    });
    expect(listCheckpoints(db, session.id)).toStrictEqual({
      ok: true,
      value: [first.checkpoint, second.checkpoint],
    });
  },
);

test(
  'insertCheckpoint picks the later-inserted checkpoint when timestamps tie',
  { concurrent: false },
  ({ expect, clock, db, deps }) => {
    const session = storedSession(db, deps);
    clock.set('2026-10-28T13:00:00Z');
    const sameInstant = countingSessionDeps(50);
    insertCheckpoint(
      db,
      recordCheckpoint(session, { baseSha: sha('f'), headSha: sha('1') }, sameInstant).checkpoint,
    );
    const latest = recordCheckpoint(session, { baseSha: sha('f'), headSha: sha('2') }, sameInstant);
    insertCheckpoint(db, latest.checkpoint);
    expect(findSession(db, session.id)).toStrictEqual({ ok: true, value: latest.session });
  },
);

test('insertCheckpoint reports an unknown session', ({ expect, db }) => {
  const sessionId = '00000000-0000-4000-8000-0000000000ff' as SessionId;
  const checkpoint = {
    id: '00000000-0000-4000-8000-0000000000fe' as CheckpointId,
    sessionId,
    baseSha: sha('f'),
    headSha: sha('1'),
    createdAt: '2026-10-28T12:00:00.000Z',
  };
  expect(insertCheckpoint(db, checkpoint)).toStrictEqual({
    ok: false,
    error: { kind: 'session-not-found', sessionId },
  });
  expect(listCheckpoints(db, sessionId)).toStrictEqual({ ok: true, value: [] });
});

function sha(digit: string): CommitSha {
  return digit.repeat(40) as CommitSha;
}

function storedSession(db: DatabaseSync, deps: SessionDeps): Session {
  const created = okValueFrom(
    createSession(
      { kind: 'local', repoPath: '/repo', baseRef: 'main', headRef: 'feat' },
      sha('1'),
      deps,
    ),
  );
  insertSession(db, created);
  return created;
}

function reload(db: DatabaseSync, id: SessionId): Session {
  const loaded = okValueFrom(findSession(db, id));
  if (loaded === undefined) {
    throw new Error(`session ${id} is missing`);
  }
  return loaded;
}
