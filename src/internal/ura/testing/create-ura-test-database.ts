import type { DatabaseSync } from 'node:sqlite';

import { openDatabase } from '#pkg/sqlite/open-database.ts';
import { runMigrations } from '#pkg/sqlite/run-migrations.ts';

import { uraMigrations } from '../ura-migrations.ts';

/**
 * An in-memory database with a stub `sessions` table (just the `id` that `ura_items` references;
 * the session domain can't be imported here, ADR 0002) and the URA migrations applied.
 */
export function createUraTestDatabase(sessionIds: readonly string[]): DatabaseSync {
  const db = openDatabase(':memory:');
  runMigrations(db, [
    { id: 'test-0000-sessions-stub', up: 'CREATE TABLE sessions (id TEXT PRIMARY KEY) STRICT;' },
    ...uraMigrations,
  ]);
  const insert = db.prepare('INSERT INTO sessions (id) VALUES (?);');
  for (const id of sessionIds) {
    insert.run(id);
  }
  return db;
}
