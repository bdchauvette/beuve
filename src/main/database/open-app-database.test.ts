import { describe, expect, it } from 'vitest';

import { appMigrations } from './app-migrations.ts';
import { openAppDatabase } from './open-app-database.ts';

const sessionMigration = /^session-/u;

describe('openAppDatabase', () => {
  it('applies every migration in order, session first, with foreign keys on', () => {
    const db = openAppDatabase(':memory:');
    const applied = db.prepare('SELECT id FROM schema_migrations ORDER BY rowid;').all();
    expect(applied.map((row) => row['id'])).toEqual(appMigrations.map(({ id }) => id));
    expect(appMigrations[0]?.id).toMatch(sessionMigration);
    expect(db.prepare('PRAGMA foreign_keys;').get()).toEqual({ foreign_keys: 1 });
    db.close();
  });

  it('closes the database and rethrows when a migration fails', () => {
    expect(() =>
      openAppDatabase(':memory:', [...appMigrations, { id: 'broken', up: 'NOT SQL;' }]),
    ).toThrow();
  });
});
