import type { DatabaseSync } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import { test } from '#testing/test.ts';

import { withResultTransaction } from './with-result-transaction.ts';

test('commits a success and returns it', ({ expect, db }) => {
  setup(db);
  const result = withResultTransaction(db, () => {
    db.exec("INSERT INTO parents VALUES ('a');");
    return ok('done');
  });
  expect(result).toStrictEqual({ ok: true, value: 'done' });
  expect(ids(db)).toStrictEqual(['a']);
  expect(db.isTransaction).toBe(false);
});

test('rolls back a failure and returns it', ({ expect, db }) => {
  setup(db);
  const result = withResultTransaction(db, () => {
    db.exec("INSERT INTO parents VALUES ('a');");
    return err('refused');
  });
  expect(result).toStrictEqual({ ok: false, error: 'refused' });
  expect(ids(db)).toStrictEqual([]);
  expect(db.isTransaction).toBe(false);
});

test('rolls back and rethrows a throw', ({ expect, db }) => {
  setup(db);
  expect(() => {
    return withResultTransaction(db, () => {
      db.exec("INSERT INTO parents VALUES ('a');");
      throw new Error('abort');
    });
  }).toThrow('abort');
  expect(ids(db)).toStrictEqual([]);
});

function setup(db: DatabaseSync): void {
  db.exec('CREATE TABLE parents (id TEXT PRIMARY KEY) STRICT;');
}

function ids(db: DatabaseSync): string[] {
  return db
    .prepare('SELECT id FROM parents ORDER BY id;')
    .all()
    .map((row) => String(row['id']));
}
