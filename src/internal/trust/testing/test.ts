import { runMigrations } from '#sqlite/run-migrations.ts';
import { test as baseTest } from '#testing/test.ts';

import { trustMigrations } from '../trust-migrations.ts';

/** `#testing/test.ts` with the trust tables (ADR 0058, 0090). */
export const test = baseTest.extend('db', ({ db }) => {
  runMigrations(db, trustMigrations);
  return db;
});
