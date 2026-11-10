import { runMigrations } from '#sqlite/run-migrations.ts';
import { test as baseTest } from '#testing/test.ts';

import { setupMigrations } from '../setup-migrations.ts';

/**
 * `#testing/test.ts` with the setup tables (ADR 0058, 0125): `db` has a stub `sessions` table
 * (just the ids `setup_runs` references; the session domain can't be imported here, ADR 0002)
 * holding sessions `s1` and `s2`.
 */
export const test = baseTest.extend('db', ({ db }) => {
  runMigrations(db, [
    {
      id: 'test-0000-stubs',
      up: `CREATE TABLE sessions (id TEXT PRIMARY KEY) STRICT;
        INSERT INTO sessions (id) VALUES ('s1'), ('s2');`,
    },
    ...setupMigrations,
  ]);
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
});
