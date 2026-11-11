import { readdirSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import { findSchemaDrift } from '#sqlite/find-schema-drift.ts';
import type { Migration } from '#sqlite/run-migrations.ts';

import type { MovedDatabase } from './open-app-database.ts';

import { appMigrations } from './app-migrations.ts';
import { openAppDatabase } from './open-app-database.ts';
import { test } from '../testing/test.ts';

describe('openAppDatabase', () => {
  test('applies every migration in order, session before ura and chat, with foreign keys on', ({
    expect,
  }) => {
    using db = openAppDatabase(':memory:');
    const applied = db.prepare('SELECT id FROM schema_migrations ORDER BY rowid;').all();
    expect(applied.map((row) => row['id'])).toStrictEqual(appMigrations.map(({ id }) => id));
    expect(appMigrations[0]?.id).toMatch(/^session-/u);
    const ids = appMigrations.map(({ id }) => id);
    expect(ids.findIndex((id) => id.startsWith('ura-'))).toBeGreaterThan(
      ids.findLastIndex((id) => id.startsWith('session-')),
    );
    expect(ids.findIndex((id) => id.startsWith('chat-'))).toBeGreaterThan(
      ids.findLastIndex((id) => id.startsWith('session-')),
    );
    expect(
      db.prepare("SELECT name FROM sqlite_schema WHERE name = 'chat_messages';").get(),
    ).toMatchObject({
      name: 'chat_messages',
    });
    expect(
      db.prepare("SELECT name FROM sqlite_schema WHERE name = 'ura_items';").get(),
    ).toMatchObject({
      name: 'ura_items',
    });
    expect(
      db.prepare("SELECT name FROM sqlite_schema WHERE name = 'agent_insights';").get(),
    ).toBeUndefined();
    expect(db.prepare('PRAGMA foreign_keys;').get()).toMatchObject({ foreign_keys: 1 });
  });

  test('closes the database and rethrows when a migration fails', ({ expect }) => {
    expect(() => {
      return openAppDatabase(':memory:', {
        migrations: [...appMigrations, { id: 'broken', up: 'NOT SQL;' }],
      });
    }).toThrow('syntax error');
  });

  test('the app migrations leave no drift behind in a file database', ({ expect, tempDir }) => {
    using db = openAppDatabase(path.join(tempDir, 'beuve.db'));
    expect(findSchemaDrift(db, appMigrations)).toStrictEqual([]);
  });

  test('sets a drifted file aside and starts a new database in its place', ({
    expect,
    tempDir,
  }) => {
    const location = path.join(tempDir, 'beuve.db');
    {
      using old = openAppDatabase(location, { migrations: notes('title TEXT NOT NULL') });
      old.exec("INSERT INTO notes VALUES ('kept');");
    }
    const movedAside: MovedDatabase[] = [];
    using db = openAppDatabase(location, {
      migrations: notes('title TEXT NOT NULL, blocking INTEGER'),
      onMovedAside: (moved) => {
        movedAside.push(moved);
      },
    });
    expect(movedAside).toHaveLength(1);
    const [moved] = movedAside;
    expect(moved?.path).toMatch(/beuve\.db\.drifted-\d{4}-\d\d-\d\dT\d{6}Z$/u);
    expect(moved?.objects).toStrictEqual(['notes']);
    expect(db.prepare('SELECT count(*) AS n FROM notes;').get()).toMatchObject({ n: 0 });
    db.exec("INSERT INTO notes VALUES ('new', 1);");
    expect(readdirSync(tempDir).filter((name) => name.includes('drifted'))).toStrictEqual([
      path.basename(moved?.path ?? ''),
    ]);
    using kept = openAppDatabase(moved?.path ?? '', {
      migrations: notes('title TEXT NOT NULL'),
    });
    expect(kept.prepare('SELECT title FROM notes;').all()).toMatchObject([{ title: 'kept' }]);
  });
});

function notes(columns: string): Migration[] {
  return [{ id: 'notes-0001-initial', up: `CREATE TABLE notes (${columns}) STRICT;` }];
}
