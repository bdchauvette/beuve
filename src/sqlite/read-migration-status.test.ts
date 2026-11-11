import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { readMigrationStatus } from './read-migration-status.ts';
import { runMigrations } from './run-migrations.ts';
import type { Migration } from './run-migrations.ts';

function migrationList(): Migration[] {
  return [
    { id: '0001-a', up: 'CREATE TABLE a (id TEXT PRIMARY KEY) STRICT;' },
    { id: '0002-b', up: 'CREATE TABLE b (id TEXT PRIMARY KEY) STRICT;' },
    { id: '0003-c', up: 'CREATE TABLE c (id TEXT PRIMARY KEY) STRICT;' },
  ];
}

describe('readMigrationStatus', () => {
  test('finds everything pending in a database that has never migrated', ({ expect, db }) => {
    const status = readMigrationStatus(db, migrationList());
    expect(status).toStrictEqual({ applied: [], pending: migrationList(), unknown: [] });
    expect(
      db.prepare("SELECT name FROM sqlite_schema WHERE name = 'schema_migrations';").all(),
    ).toStrictEqual([]);
  });

  test('splits applied from pending, in order', ({ expect, db }) => {
    runMigrations(db, migrationList().slice(0, 2));
    expect(readMigrationStatus(db, migrationList())).toStrictEqual({
      applied: ['0001-a', '0002-b'],
      pending: migrationList().slice(2),
      unknown: [],
    });
  });

  test('names applied ids the list doesn’t have', ({ expect, db }) => {
    runMigrations(db, migrationList());
    expect(readMigrationStatus(db, migrationList().slice(0, 1))).toStrictEqual({
      applied: ['0001-a', '0002-b', '0003-c'],
      pending: [],
      unknown: ['0002-b', '0003-c'],
    });
  });
});
