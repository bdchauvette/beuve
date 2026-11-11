import { describe } from 'vitest';

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
      return openAppDatabase(':memory:', [...appMigrations, { id: 'broken', up: 'NOT SQL;' }]);
    }).toThrow('syntax error');
  });
});
