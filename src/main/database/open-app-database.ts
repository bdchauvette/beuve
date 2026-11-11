// eslint-disable-next-line no-restricted-imports -- moves a whole file aside; it replaces nothing.
import { renameSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

import { findSchemaDrift } from '#sqlite/find-schema-drift.ts';
import { openDatabase } from '#sqlite/open-database.ts';
import { runMigrations } from '#sqlite/run-migrations.ts';
import type { Migration } from '#sqlite/run-migrations.ts';

import { appMigrations } from './app-migrations.ts';

/** A database file whose schema had drifted, and where it was moved. */
export interface MovedDatabase {
  readonly path: string;
  /** The tables and indexes that differed from what the migrations build. */
  readonly objects: readonly string[];
}

export interface OpenAppDatabaseOptions {
  readonly migrations?: readonly Migration[];
  /** Told when a drifted database file was moved aside and a new one started. */
  readonly onMovedAside?: (moved: MovedDatabase) => void;
}

/**
 * Opens beuve's database at `location` (`<userData>/beuve.db`, or `':memory:'` in tests) and
 * brings its schema up to date. Closes it again if a migration fails, then rethrows: the app
 * can't run on a half-migrated schema. A file whose schema differs from what the migrations build
 * (a squashed migration edited after it ran, ADR 0006 amendment) is renamed beside it, with its
 * `-wal` and `-shm`, and a new database is started in its place, so beuve never runs on a schema
 * its code doesn't match.
 */
export function openAppDatabase(
  location: string,
  options: OpenAppDatabaseOptions = {},
): DatabaseSync {
  const migrations = options.migrations ?? appMigrations;
  const db = openMigrated(location, migrations);
  if (location === ':memory:') {
    return db;
  }
  const objects = findSchemaDrift(db, migrations);
  if (objects.length === 0) {
    return db;
  }
  db.close();
  const aside = `${location}.drifted-${stamp()}`;
  renameSync(location, aside);
  for (const suffix of ['-wal', '-shm']) {
    renameIfPresent(`${location}${suffix}`, `${aside}${suffix}`);
  }
  options.onMovedAside?.({ path: aside, objects });
  return openMigrated(location, migrations);
}

function openMigrated(location: string, migrations: readonly Migration[]): DatabaseSync {
  const db = openDatabase(location);
  try {
    runMigrations(db, migrations);
  } catch (error: unknown) {
    db.close();
    throw error;
  }
  return db;
}

/** `2026-11-11T161530Z`: sortable, and without the colons some file managers show as slashes. */
function stamp(): string {
  return Temporal.Now.instant().toString({ smallestUnit: 'second' }).replaceAll(':', '');
}

function renameIfPresent(before: string, after: string): void {
  try {
    renameSync(before, after);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}
