import { describe, expect, it } from 'vitest';

import { appMigrations } from './app-migrations.ts';
import { openAppDatabase } from './open-app-database.ts';

const sessionMigration = /^session-/u;

describe('openAppDatabase', () => {
  it('applies every migration in order, session before review and ura, with foreign keys on', () => {
    const db = openAppDatabase(':memory:');
    const applied = db.prepare('SELECT id FROM schema_migrations ORDER BY rowid;').all();
    expect(applied.map((row) => row['id'])).toEqual(appMigrations.map(({ id }) => id));
    expect(appMigrations[0]?.id).toMatch(sessionMigration);
    const ids = appMigrations.map(({ id }) => id);
    const firstReview = ids.findIndex((id) => id.startsWith('review-'));
    expect(firstReview).toBeGreaterThan(ids.findLastIndex((id) => id.startsWith('session-')));
    expect(ids.findIndex((id) => id.startsWith('ura-'))).toBeGreaterThan(
      ids.findLastIndex((id) => id.startsWith('review-')),
    );
    expect(ids.findIndex((id) => id.startsWith('chat-'))).toBeGreaterThan(
      ids.findLastIndex((id) => id.startsWith('session-')),
    );
    expect(
      db.prepare("SELECT name FROM sqlite_schema WHERE name = 'chat_messages';").get(),
    ).toEqual({
      name: 'chat_messages',
    });
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name = 'ura_items';").get()).toEqual({
      name: 'ura_items',
    });
    expect(
      db.prepare("SELECT name FROM sqlite_schema WHERE name = 'agent_insights';").get(),
    ).toEqual({ name: 'agent_insights' });
    expect(db.prepare('PRAGMA foreign_keys;').get()).toEqual({ foreign_keys: 1 });
    db.close();
  });

  it('closes the database and rethrows when a migration fails', () => {
    expect(() =>
      openAppDatabase(':memory:', [...appMigrations, { id: 'broken', up: 'NOT SQL;' }]),
    ).toThrow();
  });
});
