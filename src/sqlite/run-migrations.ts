import type { DatabaseSync } from 'node:sqlite';

import { readMigrationStatus } from './read-migration-status.ts';
import { withTransaction } from './with-transaction.ts';

/**
 * One forward-only schema change. `id` is permanent once shipped; `up` is SQL, or a function for
 * a change SQL can't say well (rewriting stored JSON), run in the migration's transaction.
 */
export interface Migration {
  readonly id: string;
  readonly up: string | ((db: DatabaseSync) => void);
}

/**
 * Applies, in order, each migration not yet recorded in `schema_migrations`, one transaction
 * per migration. Safe to call repeatedly. Returns the ids applied by this call.
 *
 * Migrations run with foreign keys off (ADR 0137), so a table rebuild's `DROP TABLE` doesn't
 * cascade into its children; nor does any `DELETE`, so a migration deletes children itself. Each
 * migration commits only if `PRAGMA foreign_key_check` then finds no violation; otherwise it rolls
 * back and this throws. Foreign keys are restored afterwards. The pragma is a no-op inside a
 * transaction, so this throws if called inside one with migrations pending.
 */
export function runMigrations(db: DatabaseSync, migrations: readonly Migration[]): string[] {
  assertUniqueIds(migrations);
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;',
  );
  const { pending } = readMigrationStatus(db, migrations);
  if (pending.length === 0) {
    return [];
  }
  using _foreignKeys = suspendForeignKeys(db);
  const record = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?);');

  return pending.map((migration) => {
    return withTransaction(db, () => {
      if (typeof migration.up === 'string') {
        db.exec(migration.up);
      } else {
        migration.up(db);
      }
      assertForeignKeysHold(db, migration.id);
      record.run(migration.id, Temporal.Now.instant().toString({ fractionalSecondDigits: 3 }));
      return migration.id;
    });
  });
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

/** Turns foreign keys off until disposed, then back on if they were on. */
function suspendForeignKeys(db: DatabaseSync): DisposableStack {
  if (db.isTransaction) {
    throw new Error(
      'runMigrations must run outside a transaction: foreign keys can only be turned off between transactions.',
    );
  }
  const restore = new DisposableStack();
  if (areForeignKeysOn(db)) {
    db.exec('PRAGMA foreign_keys = OFF;');
    restore.defer(() => {
      db.exec('PRAGMA foreign_keys = ON;');
    });
  }
  return restore;
}

function areForeignKeysOn(db: DatabaseSync): boolean {
  return db.prepare('PRAGMA foreign_keys;').get()?.['foreign_keys'] === 1;
}

/**
 * Throws, naming each child and parent table, if a foreign key names a table that doesn't exist
 * (a rebuild that renamed the old table first, so its children followed the rename, ADR 0137) or
 * any row references a missing parent. `foreign_key_check` alone misses the first.
 */
function assertForeignKeysHold(db: DatabaseSync, id: string): void {
  const missing = missingParentTables(db);
  if (missing.length > 0) {
    throw new Error(
      `Migration "${id}" leaves foreign keys naming missing tables (${missing.join(', ')}); rolled back.`,
    );
  }
  const violations = db.prepare('PRAGMA foreign_key_check;').all();
  if (violations.length === 0) {
    return;
  }
  const references = new Set(
    violations.map((row) => `${String(row['table'])} → ${String(row['parent'])}`),
  );
  throw new Error(
    `Migration "${id}" leaves ${String(violations.length)} rows referencing missing parents (${[...references].join(', ')}); rolled back.`,
  );
}

/** `child → parent` for each foreign key whose parent table doesn't exist. */
function missingParentTables(db: DatabaseSync): string[] {
  const tables = db
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table';")
    .all()
    .map((row) => String(row['name']));
  const existing = new Set(tables.map((name) => name.toLowerCase()));
  const parents = db.prepare('SELECT DISTINCT "table" AS parent FROM pragma_foreign_key_list(?);');
  return tables.flatMap((table) => {
    return parents
      .all(table)
      .map((row) => String(row['parent']))
      .filter((parent) => !existing.has(parent.toLowerCase()))
      .map((parent) => `${table} → ${parent}`);
  });
}
