import { readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { backupDatabase } from './backup-database.ts';
import { openDatabase } from './open-database.ts';

describe('backupDatabase', () => {
  test('copies a WAL database into a new owner-only file', ({ expect, tempDir }) => {
    using db = openDatabase(path.join(tempDir, 'live.db'));
    db.exec('CREATE TABLE t (x INTEGER) STRICT; INSERT INTO t VALUES (7);');
    const file = path.join(tempDir, 'copy.db');

    backupDatabase(db, file);

    using copy = openDatabase(file);
    expect(copy.prepare('SELECT x FROM t;').all()).toMatchObject([{ x: 7 }]);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  test('refuses to overwrite an existing file and leaves it alone', ({ expect, db, tempDir }) => {
    const file = path.join(tempDir, 'copy.db');
    writeFileSync(file, 'keep', { mode: 0o600 });
    expect(() => {
      backupDatabase(db, file);
    }).toThrow('EEXIST');
    expect(readdirSync(tempDir)).toStrictEqual(['copy.db']);
  });

  test('removes the file again when the copy fails', ({ expect, db, tempDir }) => {
    db.exec('BEGIN;');
    expect(() => {
      backupDatabase(db, path.join(tempDir, 'copy.db'));
    }).toThrow('transaction');
    db.exec('ROLLBACK;');
    expect(readdirSync(tempDir)).toStrictEqual([]);
  });
});
