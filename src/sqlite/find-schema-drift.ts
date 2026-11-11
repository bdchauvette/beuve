import type { DatabaseSync } from 'node:sqlite';

import { openDatabase } from './open-database.ts';
import { runMigrations } from './run-migrations.ts';
import type { Migration } from './run-migrations.ts';

/**
 * The names of the tables, indexes, views and triggers whose stored SQL in `db` differs from what
 * `migrations` build in a fresh database, missing from either side included; empty when the two
 * match. It catches a database made by a migration that was edited after it ran (ADR 0006), which
 * `runMigrations` never runs again.
 */
export function findSchemaDrift(db: DatabaseSync, migrations: readonly Migration[]): string[] {
  using fresh = openDatabase(':memory:');
  runMigrations(fresh, migrations);
  const expected = schemaOf(fresh);
  const actual = schemaOf(db);
  const names = new Set([...expected.keys(), ...actual.keys()]);
  return [...names]
    .filter((name) => {
      return expected.get(name) !== actual.get(name);
    })
    .toSorted((a, b) => {
      return a.localeCompare(b);
    });
}

function schemaOf(db: DatabaseSync): Map<string, string> {
  const rows = db
    .prepare(
      "SELECT type, name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\';",
    )
    .all();
  return new Map(
    rows.map((row) => {
      return [String(row['name']), `${String(row['type'])}\n${String(row['sql'])}`];
    }),
  );
}
