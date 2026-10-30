import type { DatabaseSync } from 'node:sqlite';

import { openDatabase } from '#x/sqlite/open-database.ts';
import { runMigrations } from '#x/sqlite/run-migrations.ts';
import type { Migration } from '#x/sqlite/run-migrations.ts';

import { appMigrations } from './app-migrations.ts';

/**
 * Opens beuve's database at `location` (`<userData>/beuve.db`, or `':memory:'` in tests) and
 * brings its schema up to date. Closes it again if a migration fails, then rethrows: the app
 * can't run on a half-migrated schema.
 */
export function openAppDatabase(
  location: string,
  migrations: readonly Migration[] = appMigrations,
): DatabaseSync {
  const db = openDatabase(location);
  try {
    runMigrations(db, migrations);
  } catch (error: unknown) {
    db.close();
    throw error;
  }
  return db;
}
