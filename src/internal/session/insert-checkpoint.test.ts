import type { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { openDatabase } from '#pkg/sqlite/open-database.ts';
import { runMigrations } from '#pkg/sqlite/run-migrations.ts';

import { advanceHead } from './advance-head.ts';
import { computeReviewRange } from './compute-review-range.ts';
import { createSession } from './create-session.ts';
import { findSession } from './find-session.ts';
import { insertCheckpoint } from './insert-checkpoint.ts';
import { insertSession } from './insert-session.ts';
import { listCheckpoints } from './list-checkpoints.ts';
import { recordCheckpoint } from './record-checkpoint.ts';
import type { CheckpointId, CommitSha, Session, SessionDeps, SessionId } from './session.ts';
import { sessionMigrations } from './session-migrations.ts';
import { updateSessionHead } from './update-session-head.ts';

const rev1 = '1'.repeat(40) as CommitSha;
const rev2 = '2'.repeat(40) as CommitSha;

describe('insertCheckpoint', () => {
  it('persists the checkpoint so the stored review state matches the pure one', () => {
    const { db, deps, session } = setup();
    const { session: reviewed, checkpoint } = recordCheckpoint(session, rev1, deps);
    expect(insertCheckpoint(db, checkpoint)).toEqual({ ok: true, value: undefined });
    expect(findSession(db, session.id)).toEqual({ ok: true, value: reviewed });
    expect(listCheckpoints(db, session.id)).toEqual({ ok: true, value: [checkpoint] });
  });

  it('drives the Rev 1 to Rev 2 interdiff across reloads', () => {
    const { db, deps, session } = setup();
    const first = recordCheckpoint(session, rev1, deps);
    insertCheckpoint(db, first.checkpoint);
    const pushed = advanceHead(first.session, rev2, deps);
    expect(updateSessionHead(db, pushed)).toEqual({ ok: true, value: undefined });

    const loaded = findSession(db, session.id);
    expect(loaded.ok && loaded.value && computeReviewRange(loaded.value)).toEqual({
      kind: 'interdiff',
      fromReviewedSha: rev1,
      toHeadSha: rev2,
    });

    const second = recordCheckpoint(pushed, rev2, deps);
    insertCheckpoint(db, second.checkpoint);
    const reloaded = findSession(db, session.id);
    expect(reloaded.ok && reloaded.value && computeReviewRange(reloaded.value)).toEqual({
      kind: 'up-to-date',
      headSha: rev2,
    });
    expect(listCheckpoints(db, session.id)).toEqual({
      ok: true,
      value: [first.checkpoint, second.checkpoint],
    });
  });

  it('picks the later-inserted checkpoint when timestamps tie', () => {
    const { db, session } = setup();
    const sameInstant: SessionDeps = {
      now: (): Date => new Date(Date.UTC(2026, 9, 28, 13)),
      newId: counter(50),
    };
    insertCheckpoint(db, recordCheckpoint(session, rev1, sameInstant).checkpoint);
    const latest = recordCheckpoint(session, rev2, sameInstant);
    insertCheckpoint(db, latest.checkpoint);
    expect(findSession(db, session.id)).toEqual({ ok: true, value: latest.session });
  });

  it('reports an unknown session', () => {
    const { db } = setup();
    const sessionId = '00000000-0000-4000-8000-0000000000ff' as SessionId;
    const checkpoint = {
      id: '00000000-0000-4000-8000-0000000000fe' as CheckpointId,
      sessionId,
      commitSha: rev1,
      createdAt: '2026-10-28T12:00:00.000Z',
    };
    expect(insertCheckpoint(db, checkpoint)).toEqual({
      ok: false,
      error: { kind: 'session-not-found', sessionId },
    });
    expect(listCheckpoints(db, sessionId)).toEqual({ ok: true, value: [] });
  });
});

function setup(): { db: DatabaseSync; deps: SessionDeps; session: Session } {
  const db = openDatabase(':memory:');
  runMigrations(db, sessionMigrations);
  let minute = 0;
  const deps: SessionDeps = {
    now: (): Date => new Date(Date.UTC(2026, 9, 28, 12, minute++)),
    newId: counter(1),
  };
  const created = createSession(
    { kind: 'local', repoPath: '/repo', baseRef: 'main', headRef: 'feat' },
    rev1,
    deps,
  );
  if (!created.ok) {
    throw new Error('fixture source is invalid');
  }
  insertSession(db, created.value);
  return { db, deps, session: created.value };
}

function counter(start: number): () => string {
  let next = start;
  return (): string => `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`;
}
