import { runMigrations } from '#sqlite/run-migrations.ts';
import { test as baseTest } from '#testing/test.ts';

import { reviewEditsMigrations } from '../review-edits-migrations.ts';

/**
 * `#testing/test.ts` with the review-edits tables (ADR 0058): `db` has stub `sessions` and
 * `ura_items` tables (just the ids the domain references; other domains can't be imported here,
 * ADR 0002) holding sessions `s1` and `s2` and items `i1` and `i2`.
 */
export const test = baseTest.extend('db', ({ db }) => {
  runMigrations(db, [
    {
      id: 'test-0000-stubs',
      up: `CREATE TABLE sessions (id TEXT PRIMARY KEY) STRICT;
        CREATE TABLE ura_items (id TEXT PRIMARY KEY) STRICT;
        INSERT INTO sessions (id) VALUES ('s1'), ('s2');
        INSERT INTO ura_items (id) VALUES ('i1'), ('i2');`,
    },
    ...reviewEditsMigrations,
  ]);
  return db;
});
