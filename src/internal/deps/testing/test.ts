import { runMigrations } from '#sqlite/run-migrations.ts';
import { test as baseTest } from '#testing/test.ts';

import { depsMigrations } from '../deps-migrations.ts';

/**
 * `#testing/test.ts` with the dependency-install tables (ADR 0058): `db` has a stub `sessions`
 * table (the domain may not import the session domain, ADR 0002) holding `s1` and `s2`.
 */
export const test = baseTest.extend('db', ({ db }) => {
  runMigrations(db, [
    {
      id: 'test-0000-stubs',
      up: `CREATE TABLE sessions (id TEXT PRIMARY KEY) STRICT;
        INSERT INTO sessions (id) VALUES ('s1'), ('s2');`,
    },
    ...depsMigrations,
  ]);
  return db;
});
