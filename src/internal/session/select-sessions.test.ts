import type { DatabaseSync } from 'node:sqlite';

import { listCheckpoints } from './list-checkpoints.ts';
import { selectSessions } from './select-sessions.ts';
import type { SessionId } from './session.ts';
import { test } from './testing/test.ts';

test.for<[string, string, string]>([
  ['a bad id', "id = 'x'", 'id is not a UUID'],
  ['a bad head sha', "head_sha = 'HEAD'", 'head_sha is not a commit id'],
  ['a bad timestamp', "updated_at = 'yesterday'", 'updated_at is not an ISO-8601 UTC timestamp'],
  ['a relative repo path', "repo_path = 'repo'", 'repoPath must be absolute'],
  ['mixed source columns', 'pr_number = 3', 'kind and source columns disagree'],
])(
  'selectSessions reports a row with %s as corrupt instead of casting it',
  ([, corruption, reason], { expect, db }) => {
    corrupt(db, `UPDATE sessions SET ${corruption};`);
    expect(selectSessions(db, '1 = 1')).toMatchObject({
      ok: false,
      error: { kind: 'corrupt-row', table: 'sessions', reason },
    });
  },
);

test('selectSessions reports a corrupt latest checkpoint', ({ expect, db }) => {
  corrupt(db, `UPDATE checkpoints SET base_sha = 'abc';`);
  const expected = {
    ok: false,
    error: { kind: 'corrupt-row', table: 'checkpoints', reason: 'base_sha is not a commit id' },
  };
  expect(selectSessions(db, '1 = 1')).toMatchObject(expected);
  expect(listCheckpoints(db, sessionId())).toMatchObject(expected);
});

function sessionId(): SessionId {
  return '00000000-0000-4000-8000-000000000001' as SessionId;
}

/** Stores one valid session and checkpoint, then applies `corruption` with the checks off. */
function corrupt(db: DatabaseSync, corruption: string): void {
  const sha = 'a'.repeat(40);
  const time = '2026-10-28T12:00:00.000Z';
  db.prepare(
    `INSERT INTO sessions (id, kind, repo_path, base_ref, head_ref, head_sha, created_at, updated_at)
     VALUES (?, 'local', '/repo', 'main', 'feat', ?, ?, ?);`,
  ).run(sessionId(), sha, time, time);
  db.prepare('INSERT INTO checkpoints VALUES (?, ?, ?, ?, ?);').run(
    '00000000-0000-4000-8000-00000000000c',
    sessionId(),
    sha,
    sha,
    time,
  );
  db.exec('PRAGMA ignore_check_constraints = ON; PRAGMA foreign_keys = OFF;');
  db.exec(corruption);
}
