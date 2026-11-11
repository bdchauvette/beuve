import type { DatabaseSync } from 'node:sqlite';

/** What {@link readMigrationStatus} needs of a migration: its permanent id. */
export interface IdentifiedMigration {
  readonly id: string;
}

/** Where a database stands against a list of migrations. */
export interface MigrationStatus<M extends IdentifiedMigration> {
  /** Ids recorded in `schema_migrations`, in the order they were applied. */
  readonly applied: readonly string[];
  /** The list's migrations not yet applied, in list order. */
  readonly pending: readonly M[];
  /** Applied ids the list doesn't have: a newer build wrote them, or the list lost one. */
  readonly unknown: readonly string[];
}

/**
 * Compares `schema_migrations` with `migrations` without changing the database. A database that
 * has no `schema_migrations` table yet has applied nothing.
 */
export function readMigrationStatus<M extends IdentifiedMigration>(
  db: DatabaseSync,
  migrations: readonly M[],
): MigrationStatus<M> {
  const applied = appliedIds(db);
  const recorded = new Set(applied);
  const known = new Set(migrations.map(({ id }) => id));
  return {
    applied,
    pending: migrations.filter(({ id }) => !recorded.has(id)),
    unknown: applied.filter((id) => !known.has(id)),
  };
}

function appliedIds(db: DatabaseSync): string[] {
  const table = db
    .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'schema_migrations';")
    .get();
  if (table === undefined) {
    return [];
  }
  const rows = db.prepare('SELECT id FROM schema_migrations ORDER BY rowid;').all();
  return rows.map((row) => String(row['id']));
}
