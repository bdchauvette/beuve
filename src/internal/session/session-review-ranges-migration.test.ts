import type { DatabaseSync } from 'node:sqlite';

import { describe } from 'vitest';

import { test } from './testing/test.ts';

describe('sessionReviewRangesMigration', () => {
  test.for<[string, string, string | undefined]>([
    ['the whole change', 'whole', undefined],
    ['the change since a checkpoint', 'since-checkpoint', checkpointId()],
  ])('accepts %s', ([, kind, checkpoint], { expect, db }) => {
    insertSessionAndCheckpoint(db);
    insertRange(db, { kind, checkpoint });
    expect(db.prepare('SELECT count(*) AS n FROM review_ranges;').get()).toMatchObject({ n: 1 });
  });

  test.for<[string, string, string | undefined]>([
    ['an unknown kind', 'since-last', undefined],
    ['a whole range that names a checkpoint', 'whole', checkpointId()],
    ['a checkpoint range without a checkpoint', 'since-checkpoint', undefined],
  ])('rejects %s', ([, kind, checkpoint], { expect, db }) => {
    insertSessionAndCheckpoint(db);
    expect(() => {
      insertRange(db, { kind, checkpoint });
    }).toThrow('CHECK constraint failed');
  });

  test('deletes a choice with the checkpoint it names', ({ expect, db }) => {
    insertSessionAndCheckpoint(db);
    insertRange(db, { kind: 'since-checkpoint', checkpoint: checkpointId() });
    db.prepare('DELETE FROM checkpoints;').run();
    expect(db.prepare('SELECT count(*) AS n FROM review_ranges;').get()).toMatchObject({ n: 0 });
  });
});

/** A `review_ranges` row's values. */
interface RangeRow {
  readonly kind: string;
  readonly checkpoint: string | undefined;
}

function insertRange(db: DatabaseSync, { kind, checkpoint }: RangeRow): void {
  if (checkpoint === undefined) {
    db.prepare('INSERT INTO review_ranges (session_id, kind) VALUES (?, ?);').run(
      sessionId(),
      kind,
    );
    return;
  }
  db.prepare('INSERT INTO review_ranges (session_id, kind, checkpoint_id) VALUES (?, ?, ?);').run(
    sessionId(),
    kind,
    checkpoint,
  );
}

function insertSessionAndCheckpoint(db: DatabaseSync): void {
  const sha = 'a'.repeat(40);
  const time = '2026-11-18T12:00:00.000Z';
  db.prepare(
    `INSERT INTO sessions (id, kind, repo_path, base_ref, head_ref, head_sha, created_at, updated_at)
      VALUES (?, 'local', '/repo', 'main', 'feature', ?, ?, ?);`,
  ).run(sessionId(), sha, time, time);
  db.prepare('INSERT INTO checkpoints VALUES (?, ?, ?, ?, ?);').run(
    checkpointId(),
    sessionId(),
    sha,
    sha,
    time,
  );
}

function sessionId(): string {
  return '00000000-0000-4000-8000-000000000001';
}

function checkpointId(): string {
  return '00000000-0000-4000-8000-00000000000c';
}
