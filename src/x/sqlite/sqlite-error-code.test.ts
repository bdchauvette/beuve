import { describe, expect, it } from 'vitest';

import { openDatabase } from './open-database.ts';
import { sqliteErrorCode } from './sqlite-error-code.ts';

describe('sqliteErrorCode', () => {
  it('reads the extended code of a node:sqlite error', () => {
    const database = openDatabase(':memory:');
    database.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
    database.exec('INSERT INTO t VALUES (1)');
    let caught: unknown;
    try {
      database.exec('INSERT INTO t VALUES (1)');
    } catch (error) {
      caught = error;
    }
    expect(sqliteErrorCode(caught)).toBe(1555);
  });

  it('is undefined for anything else', () => {
    expect(sqliteErrorCode(new Error('x'))).toBeUndefined();
    expect(sqliteErrorCode('x')).toBeUndefined();
  });
});
