import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { sqliteErrorCode } from './sqlite-error-code.ts';

describe('sqliteErrorCode', () => {
  test('reads the extended code of a node:sqlite error', ({ expect, db: database }) => {
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

  test('is undefined for anything else', ({ expect }) => {
    expect(sqliteErrorCode(new Error('x'))).toBeUndefined();
    expect(sqliteErrorCode('x')).toBeUndefined();
  });
});
