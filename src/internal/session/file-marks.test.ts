import type { DatabaseSync } from 'node:sqlite';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { createSession } from './create-session.ts';
import { insertSession } from './insert-session.ts';
import { listFileMarks } from './list-file-marks.ts';
import { removeFileMarks } from './remove-file-marks.ts';
import type { CommitSha, FileMark, Session, SessionDeps, SessionId } from './session.ts';
import { setFileMark } from './set-file-mark.ts';
import { test } from './testing/test.ts';

test('setFileMark stores a mark and replaces the one for the same path', ({ expect, db, deps }) => {
  const session = storedSession(db, deps);
  expect(setFileMark(db, mark(session.id, { path: 'src/a.ts', seed: 'a' }))).toStrictEqual({
    ok: true,
    value: undefined,
  });
  setFileMark(db, mark(session.id, { path: 'src/b.ts', seed: 'b' }));
  setFileMark(db, { ...mark(session.id, { path: 'src/a.ts', seed: 'c' }), headSha: sha('2') });
  expect(
    okValueFrom(listFileMarks(db, session.id)).map(({ path, diffId, headSha }) => {
      return [path, diffId[0], headSha[0]];
    }),
  ).toStrictEqual([
    ['src/a.ts', 'c', '2'],
    ['src/b.ts', 'b', '1'],
  ]);
});

test('setFileMark moves the mark of a renamed file', ({ expect, db, deps }) => {
  const session = storedSession(db, deps);
  setFileMark(db, mark(session.id, { path: 'old.ts', seed: 'a' }));
  setFileMark(db, mark(session.id, { path: 'new.ts', seed: 'a' }), 'old.ts');
  expect(okValueFrom(listFileMarks(db, session.id)).map(({ path }) => path)).toStrictEqual([
    'new.ts',
  ]);
});

test('setFileMark reports an unknown session', ({ expect, db }) => {
  const sessionId = '00000000-0000-4000-8000-0000000000ff' as SessionId;
  expect(setFileMark(db, mark(sessionId, { path: 'a.ts', seed: 'a' }))).toStrictEqual({
    ok: false,
    error: { kind: 'session-not-found', sessionId },
  });
});

test('removeFileMarks removes only the named paths of one session', ({ expect, db, deps }) => {
  const session = storedSession(db, deps);
  setFileMark(db, mark(session.id, { path: 'a.ts', seed: 'a' }));
  setFileMark(db, mark(session.id, { path: 'b.ts', seed: 'b' }));
  removeFileMarks(db, session.id, ['a.ts', 'missing.ts']);
  expect(okValueFrom(listFileMarks(db, session.id)).map(({ path }) => path)).toStrictEqual([
    'b.ts',
  ]);
});

test('marks are deleted with their session', ({ expect, db, deps }) => {
  const session = storedSession(db, deps);
  setFileMark(db, mark(session.id, { path: 'a.ts', seed: 'a' }));
  db.prepare('DELETE FROM sessions;').run();
  expect(okValueFrom(listFileMarks(db, session.id))).toStrictEqual([]);
});

test('listFileMarks reports a corrupt row', ({ expect, db, deps }) => {
  const session = storedSession(db, deps);
  db.exec('PRAGMA ignore_check_constraints = ON;');
  db.prepare(
    "INSERT INTO file_marks VALUES (?, 'a.ts', 'nothex', ?, '2026-10-28T12:00:00.000Z');",
  ).run(session.id, sha('1'));
  expect(listFileMarks(db, session.id)).toMatchObject({
    ok: false,
    error: { kind: 'corrupt-row', table: 'file_marks' },
  });
});

function sha(digit: string): CommitSha {
  return digit.repeat(40) as CommitSha;
}

/** A mark on `path`; `seed` is repeated into its diff id. */
interface MarkSeed {
  readonly path: string;
  readonly seed: string;
}

function mark(sessionId: SessionId, { path, seed }: MarkSeed): FileMark {
  return {
    sessionId,
    path,
    diffId: seed.repeat(64),
    headSha: sha('1'),
    markedAt: '2026-10-28T12:00:00.000Z',
  };
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
