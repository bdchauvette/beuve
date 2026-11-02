import { describe } from 'vitest';

import { test } from '#testing/test.ts';
import { runMigrations } from '#sqlite/run-migrations.ts';

import { retiredMigrations } from './retired-migrations.ts';

describe('retiredMigrations', () => {
  test('deletes staged ImpactGate findings and keeps every other item', ({ expect, db }) => {
    db.exec(`
      CREATE TABLE ura_items (id TEXT PRIMARY KEY, origin_kind TEXT NOT NULL);
      INSERT INTO ura_items (id, origin_kind)
        VALUES ('a', 'human'), ('b', 'impact-finding'), ('c', 'chat-answer');
    `);
    runMigrations(db, retiredMigrations);
    const rows = db.prepare('SELECT id FROM ura_items ORDER BY id;').all();
    expect(
      rows.map((row) => {
        return row['id'];
      }),
    ).toStrictEqual(['a', 'c']);
  });

  test('drops the trust grants table of older databases', ({ expect, db }) => {
    db.exec(`
      CREATE TABLE ura_items (id TEXT PRIMARY KEY, origin_kind TEXT NOT NULL);
      CREATE TABLE trust_grants (repo_path TEXT PRIMARY KEY);
    `);
    runMigrations(db, retiredMigrations);
    expect(
      db.prepare("SELECT name FROM sqlite_schema WHERE name = 'trust_grants';").get(),
    ).toBeUndefined();
  });
});
