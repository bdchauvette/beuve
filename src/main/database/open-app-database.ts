import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { openDatabase } from '#sqlite/open-database.ts';
import { readMigrationStatus } from '#sqlite/read-migration-status.ts';
import { runMigrations } from '#sqlite/run-migrations.ts';
import type { Migration } from '#sqlite/run-migrations.ts';
import type { Logger } from '#x/log/create-logger.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { appMigrations } from './app-migrations.ts';
import { backupAppDatabase } from './backup-app-database.ts';

export interface OpenAppDatabaseOptions {
  /** `<userData>/beuve.db`, or `':memory:'` in tests. Backups go to `backups/` beside a file. */
  readonly location: string;
  readonly logger: Logger;
  /** Every migration this build knows, in order; {@link appMigrations} unless a test says. */
  readonly migrations?: readonly Migration[] | undefined;
}

/**
 * The database records migrations this build doesn't have: a newer beuve wrote it, and this one
 * can't tell what its schema means (ADR 0137).
 */
export interface NewerDatabaseError {
  readonly kind: 'newer-database';
  readonly location: string;
  readonly unknownIds: readonly string[];
}

/** Why {@link openAppDatabase} left the database alone; the app can't start on it. */
export type OpenAppDatabaseError = NewerDatabaseError;

/**
 * Opens beuve's database and brings its schema up to date (ADR 0006, 0137). A database that has
 * applied a migration this build doesn't know is closed untouched and reported. Before migrating a
 * file database that has applied any migration, it is copied to `backups/` (see
 * `backupAppDatabase`); a new database and `':memory:'` aren't. A failing backup or migration
 * closes the database and throws: the app can't run on a half-migrated schema.
 */
export function openAppDatabase(
  options: OpenAppDatabaseOptions,
): Result<DatabaseSync, OpenAppDatabaseError> {
  const { location, logger } = options;
  const migrations = options.migrations ?? appMigrations;
  using opened = new DisposableStack();
  const db = opened.use(openDatabase(location));
  const status = readMigrationStatus(db, migrations);
  if (status.unknown.length > 0) {
    return err({ kind: 'newer-database', location, unknownIds: status.unknown });
  }
  const lastAppliedId = status.applied.at(-1);
  if (location !== ':memory:' && lastAppliedId !== undefined && status.pending.length > 0) {
    const backup = backupAppDatabase(db, {
      directory: path.join(path.dirname(location), 'backups'),
      lastAppliedId,
    });
    logger.info('backed up the database before migrating', { ...backup });
  }
  const applied = runMigrations(db, migrations);
  if (applied.length > 0) {
    logger.info('migrated the database', { applied });
  }
  opened.move();
  return ok(db);
}
