import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { findSchemaDrift } from './find-schema-drift.ts';
import { runMigrations } from './run-migrations.ts';
import type { Migration } from './run-migrations.ts';

function initial(columns: string): Migration[] {
  return [{ id: '0001-initial', up: `CREATE TABLE notes (${columns}) STRICT;` }];
}

describe('findSchemaDrift', () => {
  test('finds nothing when the database is what the migrations build', ({ expect, db }) => {
    const migrations = [
      ...initial('id TEXT PRIMARY KEY, title TEXT NOT NULL'),
      { id: '0002-index', up: 'CREATE INDEX notes_by_title ON notes (title);' },
    ];
    runMigrations(db, migrations);
    expect(findSchemaDrift(db, migrations)).toStrictEqual([]);
  });

  test('names a table whose migration was edited after it ran', ({ expect, db }) => {
    runMigrations(db, initial('id TEXT PRIMARY KEY, title TEXT NOT NULL'));
    const edited = initial('id TEXT PRIMARY KEY, title TEXT NOT NULL, blocking INTEGER');
    expect(runMigrations(db, edited)).toStrictEqual([]);
    expect(findSchemaDrift(db, edited)).toStrictEqual(['notes']);
  });

  test('names objects missing from either side', ({ expect, db }) => {
    runMigrations(db, [
      ...initial('id TEXT PRIMARY KEY'),
      { id: '0002-old', up: 'CREATE TABLE retired (id TEXT) STRICT;' },
    ]);
    const current = [
      ...initial('id TEXT PRIMARY KEY'),
      { id: '0002-old', up: 'CREATE TABLE added (id TEXT) STRICT;' },
    ];
    expect(findSchemaDrift(db, current)).toStrictEqual(['added', 'retired']);
  });
});
