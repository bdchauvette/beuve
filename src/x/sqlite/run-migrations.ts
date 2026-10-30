import type { DatabaseSync } from 'node:sqlite';

import { withTransaction } from './with-transaction.ts';

/** One forward-only schema change. `id` is permanent once shipped; `up` is SQL. */
export interface Migration {
  readonly id: string;
  readonly up: string;
}

/**
 * Applies, in order, each migration not yet recorded in `schema_migrations`, one transaction
 * per migration. Safe to call repeatedly. Returns the ids applied by this call.
 */
export function runMigrations(db: DatabaseSync, migrations: readonly Migration[]): string[] {
  assertUniqueIds(migrations);
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;',
  );
  const applied = appliedIds(db);
  const record = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?);');

  return migrations
    .filter((migration) => !applied.has(migration.id))
    .map((migration) =>
      withTransaction(db, () => {
        db.exec(migration.up);
        record.run(migration.id, new Date().toISOString());
        return migration.id;
      }),
    );
}

function assertUniqueIds(migrations: readonly Migration[]): void {
  const seen = new Set<string>();
  for (const { id } of migrations) {
    if (seen.has(id)) {
      throw new Error(`Duplicate migration id "${id}".`);
    }
    seen.add(id);
  }
}

function appliedIds(db: DatabaseSync): Set<string> {
  const rows = db.prepare('SELECT id FROM schema_migrations;').all();
  return new Set(rows.map((row) => String(row['id'])));
}
