import { chmodSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { openDatabase } from './open-database.ts';
import { runMigrations } from './run-migrations.ts';
import type { Migration } from './run-migrations.ts';
import { withTransaction } from './with-transaction.ts';

function migrationList(): Migration[] {
  return [
    { id: '0001-parents', up: 'CREATE TABLE parents (id TEXT PRIMARY KEY) STRICT;' },
    {
      id: '0002-children',
      up: 'CREATE TABLE children (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parents (id)) STRICT;',
    },
  ];
}

function cascadingMigrationList(): Migration[] {
  return [
    { id: '0001-parents', up: 'CREATE TABLE parents (id TEXT PRIMARY KEY) STRICT;' },
    {
      id: '0002-children',
      up: 'CREATE TABLE children (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parents (id) ON DELETE CASCADE) STRICT;',
    },
  ];
}

describe('openDatabase', () => {
  test('enforces foreign keys', ({ expect, db }) => {
    runMigrations(db, migrationList());
    expect(() => {
      db.exec("INSERT INTO children VALUES ('c', 'missing');");
    }).toThrow('FOREIGN KEY');
  });

  test('uses WAL for files but not for :memory:', ({ expect, db, tempDir }) => {
    using file = openDatabase(path.join(tempDir, 'test.db'));
    expect(file.prepare('PRAGMA journal_mode;').get()).toMatchObject({ journal_mode: 'wal' });
    expect(db.prepare('PRAGMA journal_mode;').get()).toMatchObject({ journal_mode: 'memory' });
  });

  test('creates a file database and its WAL files owner-only', ({ expect, tempDir }) => {
    const location = path.join(tempDir, 'test.db');
    using file = openDatabase(location);
    file.exec('CREATE TABLE t (x INTEGER) STRICT; INSERT INTO t VALUES (1);');
    const modes = readdirSync(tempDir)
      .toSorted((a, b) => a.localeCompare(b))
      .map((name) => {
        return [name, statSync(path.join(tempDir, name)).mode & 0o777];
      });
    expect(modes).toStrictEqual([
      ['test.db', 0o600],
      ['test.db-shm', 0o600],
      ['test.db-wal', 0o600],
    ]);
  });

  test('keeps the contents and mode of an existing file database', ({ expect, tempDir }) => {
    const location = path.join(tempDir, 'test.db');
    {
      using first = openDatabase(location);
      first.exec('CREATE TABLE t (x INTEGER) STRICT; INSERT INTO t VALUES (7);');
    }
    chmodSync(location, 0o640);
    using again = openDatabase(location);
    expect(again.prepare('SELECT x FROM t;').get()).toMatchObject({ x: 7 });
    expect(statSync(location).mode & 0o777).toBe(0o640);
  });
});

describe('runMigrations', () => {
  test('applies pending migrations in order and is idempotent', ({ expect, db }) => {
    const migrations = migrationList();
    expect(runMigrations(db, migrations.slice(0, 1))).toStrictEqual(['0001-parents']);
    expect(runMigrations(db, migrations)).toStrictEqual(['0002-children']);
    expect(runMigrations(db, migrations)).toStrictEqual([]);
    const ids = db.prepare('SELECT id FROM schema_migrations ORDER BY id;').all();
    expect(ids).toMatchObject([{ id: '0001-parents' }, { id: '0002-children' }]);
  });

  test('rolls back a failing migration and leaves it unrecorded', ({ expect, db }) => {
    const migrations = migrationList();
    const broken: Migration = { id: '0003-broken', up: 'CREATE TABLE t (a); NOT VALID SQL;' };
    expect(() => {
      return runMigrations(db, [...migrations, broken]);
    }).toThrow('syntax error');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE name = 't';").all();
    expect(tables).toStrictEqual([]);
    expect(runMigrations(db, migrations)).toStrictEqual([]);
  });

  test('runs a function migration in its transaction', ({ expect, db }) => {
    const migrations = migrationList();
    const copy: Migration = {
      id: '0003-copy',
      up: (inner): void => {
        inner.exec('CREATE TABLE copies (name TEXT) STRICT;');
        inner.prepare('INSERT INTO copies (name) VALUES (?);').run('first');
      },
    };
    const failing: Migration = {
      id: '0004-failing',
      up: (inner): void => {
        inner.exec('CREATE TABLE doomed (name TEXT) STRICT;');
        throw new Error('stop');
      },
    };
    expect(runMigrations(db, [...migrations, copy])).toStrictEqual([
      '0001-parents',
      '0002-children',
      '0003-copy',
    ]);
    expect(db.prepare('SELECT name FROM copies;').all()).toMatchObject([{ name: 'first' }]);
    expect(() => {
      return runMigrations(db, [...migrations, copy, failing]);
    }).toThrow('stop');
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'doomed';").all()).toStrictEqual(
      [],
    );
  });

  test('rejects duplicate ids', ({ expect, db }) => {
    const first = migrationList().slice(0, 1);
    expect(() => {
      return runMigrations(db, [...first, ...first]);
    }).toThrow('Duplicate migration id');
  });
});

describe('runMigrations with foreign keys (ADR 0137)', () => {
  test('rebuilds a parent table without cascading into its children', ({ expect, db }) => {
    runMigrations(db, cascadingMigrationList());
    db.exec("INSERT INTO parents VALUES ('p'); INSERT INTO children VALUES ('c', 'p');");
    const rebuild: Migration = {
      id: '0003-rebuild-parents',
      up: `
        CREATE TABLE parents_new (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '') STRICT;
        INSERT INTO parents_new (id) SELECT id FROM parents;
        DROP TABLE parents;
        ALTER TABLE parents_new RENAME TO parents;
      `,
    };

    expect(runMigrations(db, [...cascadingMigrationList(), rebuild])).toStrictEqual([
      '0003-rebuild-parents',
    ]);

    expect(db.prepare('SELECT id, parent_id FROM children;').all()).toMatchObject([
      { id: 'c', parent_id: 'p' },
    ]);
    expect(db.prepare('PRAGMA foreign_keys;').get()).toMatchObject({ foreign_keys: 1 });
    expect(() => {
      db.exec("INSERT INTO children VALUES ('d', 'missing');");
    }).toThrow('FOREIGN KEY');
    db.exec('DELETE FROM parents;');
    expect(db.prepare('SELECT count(*) AS n FROM children;').get()).toMatchObject({ n: 0 });
  });

  test('rolls back a migration that leaves a row referencing a missing parent', ({
    expect,
    db,
  }) => {
    runMigrations(db, cascadingMigrationList());
    db.exec("INSERT INTO parents VALUES ('p'); INSERT INTO children VALUES ('c', 'p');");
    const orphaning: Migration = { id: '0003-orphan', up: 'DELETE FROM parents;' };

    expect(() => {
      return runMigrations(db, [...cascadingMigrationList(), orphaning]);
    }).toThrow(
      'Migration "0003-orphan" leaves 1 rows referencing missing parents (children → parents)',
    );

    expect(db.prepare('SELECT id FROM parents;').all()).toMatchObject([{ id: 'p' }]);
    expect(db.prepare('SELECT id FROM children;').all()).toMatchObject([{ id: 'c' }]);
    expect(
      db.prepare("SELECT id FROM schema_migrations WHERE id = '0003-orphan';").all(),
    ).toStrictEqual([]);
    expect(db.prepare('PRAGMA foreign_keys;').get()).toMatchObject({ foreign_keys: 1 });
  });

  test('rolls back a rebuild that renames the old table first, which moves its children’s keys', ({
    expect,
    db,
  }) => {
    runMigrations(db, cascadingMigrationList());
    db.exec("INSERT INTO parents VALUES ('p'); INSERT INTO children VALUES ('c', 'p');");
    const renameFirst: Migration = {
      id: '0003-rename-first',
      up: `
        ALTER TABLE parents RENAME TO parents_old;
        CREATE TABLE parents (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '') STRICT;
        INSERT INTO parents (id) SELECT id FROM parents_old;
        DROP TABLE parents_old;
      `,
    };

    expect(() => {
      return runMigrations(db, [...cascadingMigrationList(), renameFirst]);
    }).toThrow('foreign keys naming missing tables (children → parents_old)');

    expect(
      db.prepare("SELECT sql FROM sqlite_schema WHERE name = 'children';").get()?.['sql'],
    ).toContain('REFERENCES parents (id)');
  });

  test('leaves foreign keys off when they were off', ({ expect, db }) => {
    db.exec('PRAGMA foreign_keys = OFF;');
    runMigrations(db, migrationList());
    expect(db.prepare('PRAGMA foreign_keys;').get()).toMatchObject({ foreign_keys: 0 });
  });

  test('refuses to run pending migrations inside a transaction', ({ expect, db }) => {
    expect(() => {
      return withTransaction(db, () => runMigrations(db, migrationList()));
    }).toThrow('outside a transaction');
    expect(
      db.prepare("SELECT name FROM sqlite_schema WHERE name = 'parents';").all(),
    ).toStrictEqual([]);
  });
});

describe('withTransaction', () => {
  test('commits on success and returns the result', ({ expect, db }) => {
    setup(db);
    const result = withTransaction(db, () => {
      db.exec("INSERT INTO parents VALUES ('a');");
      return 'done';
    });
    expect(result).toBe('done');
    expect(count(db)).toMatchObject({ n: 1 });
    expect(db.isTransaction).toBe(false);
  });

  test('rolls back on throw', ({ expect, db }) => {
    setup(db);
    expect(() => {
      return withTransaction(db, () => {
        db.exec("INSERT INTO parents VALUES ('a');");
        throw new Error('abort');
      });
    }).toThrow('abort');
    expect(count(db)).toMatchObject({ n: 0 });
    expect(db.isTransaction).toBe(false);
  });

  test('rolls back only the inner savepoint when a nested call fails', ({ expect, db }) => {
    setup(db);
    withTransaction(db, () => {
      db.exec("INSERT INTO parents VALUES ('outer');");
      expect(() => {
        return withTransaction(db, () => {
          db.exec("INSERT INTO parents VALUES ('inner');");
          throw new Error('inner');
        });
      }).toThrow('inner');
    });
    expect(db.prepare('SELECT id FROM parents;').all()).toMatchObject([{ id: 'outer' }]);
  });

  test('rejects asynchronous work', ({ expect, db }) => {
    setup(db);
    expect(() => {
      void withTransaction(db, asyncWork);
    }).toThrow(TypeError);
    expect(db.isTransaction).toBe(false);
  });
});

function setup(db: DatabaseSync): DatabaseSync {
  runMigrations(db, migrationList());
  return db;
}

function count(db: DatabaseSync): unknown {
  return db.prepare('SELECT count(*) AS n FROM parents;').get();
}

async function asyncWork(): Promise<void> {
  await Promise.resolve();
}
