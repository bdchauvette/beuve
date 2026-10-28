import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from './open-database.ts';
import { runMigrations } from './run-migrations.ts';
import type { Migration } from './run-migrations.ts';
import { withTransaction } from './with-transaction.ts';

const migrations: Migration[] = [
  { id: '0001-parents', up: 'CREATE TABLE parents (id TEXT PRIMARY KEY) STRICT;' },
  {
    id: '0002-children',
    up: 'CREATE TABLE children (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parents (id)) STRICT;',
  },
];

describe('openDatabase', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('enforces foreign keys', () => {
    const db = openDatabase(':memory:');
    runMigrations(db, migrations);
    expect(() => {
      db.exec("INSERT INTO children VALUES ('c', 'missing');");
    }).toThrow('FOREIGN KEY');
  });

  it('uses WAL for files but not for :memory:', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'beuve-sqlite-'));
    directories.push(directory);
    const file = openDatabase(path.join(directory, 'test.db'));
    const memory = openDatabase(':memory:');
    expect(file.prepare('PRAGMA journal_mode;').get()).toEqual({ journal_mode: 'wal' });
    expect(memory.prepare('PRAGMA journal_mode;').get()).toEqual({ journal_mode: 'memory' });
    file.close();
  });
});

describe('runMigrations', () => {
  it('applies pending migrations in order and is idempotent', () => {
    const db = openDatabase(':memory:');
    expect(runMigrations(db, migrations.slice(0, 1))).toEqual(['0001-parents']);
    expect(runMigrations(db, migrations)).toEqual(['0002-children']);
    expect(runMigrations(db, migrations)).toEqual([]);
    const ids = db.prepare('SELECT id FROM schema_migrations ORDER BY id;').all();
    expect(ids).toEqual([{ id: '0001-parents' }, { id: '0002-children' }]);
  });

  it('rolls back a failing migration and leaves it unrecorded', () => {
    const db = openDatabase(':memory:');
    const broken: Migration = { id: '0003-broken', up: 'CREATE TABLE t (a); NOT VALID SQL;' };
    expect(() => runMigrations(db, [...migrations, broken])).toThrow();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE name = 't';").all();
    expect(tables).toEqual([]);
    expect(runMigrations(db, migrations)).toEqual([]);
  });

  it('rejects duplicate ids', () => {
    const db = openDatabase(':memory:');
    const first = migrations[0];
    expect(first).toBeDefined();
    if (first !== undefined) {
      expect(() => runMigrations(db, [first, first])).toThrow('Duplicate migration id');
    }
  });
});

describe('withTransaction', () => {
  it('commits on success and returns the result', () => {
    const db = setup();
    const result = withTransaction(db, () => {
      db.exec("INSERT INTO parents VALUES ('a');");
      return 'done';
    });
    expect(result).toBe('done');
    expect(count(db)).toEqual({ n: 1 });
    expect(db.isTransaction).toBe(false);
  });

  it('rolls back on throw', () => {
    const db = setup();
    expect(() =>
      withTransaction(db, () => {
        db.exec("INSERT INTO parents VALUES ('a');");
        throw new Error('abort');
      }),
    ).toThrow('abort');
    expect(count(db)).toEqual({ n: 0 });
    expect(db.isTransaction).toBe(false);
  });

  it('rolls back only the inner savepoint when a nested call fails', () => {
    const db = setup();
    withTransaction(db, () => {
      db.exec("INSERT INTO parents VALUES ('outer');");
      expect(() =>
        withTransaction(db, () => {
          db.exec("INSERT INTO parents VALUES ('inner');");
          throw new Error('inner');
        }),
      ).toThrow('inner');
    });
    expect(db.prepare('SELECT id FROM parents;').all()).toEqual([{ id: 'outer' }]);
  });

  it('rejects asynchronous work', () => {
    const db = setup();
    expect(() => {
      void withTransaction(db, asyncWork);
    }).toThrow(TypeError);
    expect(db.isTransaction).toBe(false);
  });
});

function setup(): DatabaseSync {
  const db = openDatabase(':memory:');
  runMigrations(db, migrations);
  return db;
}

function count(db: DatabaseSync): unknown {
  return db.prepare('SELECT count(*) AS n FROM parents;').get();
}

async function asyncWork(): Promise<void> {
  await Promise.resolve();
}
