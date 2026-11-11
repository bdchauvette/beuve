import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { describe } from 'vitest';

import type { Migration } from '#sqlite/run-migrations.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { appMigrations } from './app-migrations.ts';
import { openAppDatabase } from './open-app-database.ts';
import { test } from '../testing/test.ts';

function migrationList(): Migration[] {
  return [
    { id: 'demo-0001-a', up: 'CREATE TABLE a (id TEXT PRIMARY KEY) STRICT;' },
    { id: 'demo-0002-b', up: 'CREATE TABLE b (id TEXT PRIMARY KEY) STRICT;' },
  ];
}

describe('openAppDatabase', () => {
  test('applies every migration in order, session before ura and chat, with foreign keys on', ({
    expect,
    logger,
  }) => {
    using db = okValueFrom(openAppDatabase({ location: ':memory:', logger: logger.logger }));
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

  test('closes the database and rethrows when a migration fails', ({ expect, logger }) => {
    expect(() => {
      return openAppDatabase({
        location: ':memory:',
        logger: logger.logger,
        migrations: [...appMigrations, { id: 'broken', up: 'NOT SQL;' }],
      });
    }).toThrow('syntax error');
  });

  test('refuses a database a newer build migrated, and leaves it as it was', ({
    expect,
    tempDir,
    logger,
  }) => {
    const location = path.join(tempDir, 'beuve.db');
    okValueFrom(
      openAppDatabase({ location, logger: logger.logger, migrations: migrationList() }),
    ).close();

    expect(
      openAppDatabase({ location, logger: logger.logger, migrations: migrationList().slice(0, 1) }),
    ).toStrictEqual({
      ok: false,
      error: { kind: 'newer-database', location, unknownIds: ['demo-0002-b'] },
    });
    expect(readdirSync(tempDir)).not.toContain('backups');
  });

  test('backs up a migrated file database, owner-only, before migrating it further', ({
    expect,
    tempDir,
    logger,
  }) => {
    const location = path.join(tempDir, 'beuve.db');
    okValueFrom(
      openAppDatabase({ location, logger: logger.logger, migrations: migrationList().slice(0, 1) }),
    ).close();
    expect(readdirSync(tempDir)).not.toContain('backups');

    okValueFrom(
      openAppDatabase({ location, logger: logger.logger, migrations: migrationList() }),
    ).close();

    const backups = path.join(tempDir, 'backups');
    const [name, ...others] = readdirSync(backups);
    expect(others).toStrictEqual([]);
    expect(name).toMatch(/^beuve-\d{4}-\d{2}-\d{2}T\d{6}\.\d{3}Z-demo-0001-a\.db$/u);
    const file = path.join(backups, String(name));
    expect(statSync(backups).mode & 0o777).toBe(0o700);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    using copy = new DatabaseSync(file, { readOnly: true });
    expect(copy.prepare('SELECT id FROM schema_migrations;').all()).toMatchObject([
      { id: 'demo-0001-a' },
    ]);
    expect(logger.lines).toMatchObject([
      { message: 'migrated the database', applied: ['demo-0001-a'] },
      { message: 'backed up the database before migrating', file, removed: [] },
      { message: 'migrated the database', applied: ['demo-0002-b'] },
    ]);

    okValueFrom(
      openAppDatabase({ location, logger: logger.logger, migrations: migrationList() }),
    ).close();
    expect(readdirSync(backups)).toStrictEqual([name]);
  });

  test('keeps the newest three backups and nothing else it named', ({
    expect,
    tempDir,
    logger,
  }) => {
    const location = path.join(tempDir, 'beuve.db');
    okValueFrom(
      openAppDatabase({ location, logger: logger.logger, migrations: migrationList().slice(0, 1) }),
    ).close();
    const backups = path.join(tempDir, 'backups');
    mkdirSync(backups, { mode: 0o700 });
    const older = [
      'beuve-2026-01-01T000000.000Z-demo-0001-a.db',
      'beuve-2026-02-01T000000.000Z-demo-0001-a.db',
      'beuve-2026-03-01T000000.000Z-demo-0001-a.db',
    ];
    for (const name of [...older, 'notes.txt']) {
      writeFileSync(path.join(backups, name), '', { mode: 0o600 });
    }

    okValueFrom(
      openAppDatabase({ location, logger: logger.logger, migrations: migrationList() }),
    ).close();

    const kept = readdirSync(backups).toSorted((a, b) => a.localeCompare(b));
    expect(kept).toHaveLength(4);
    expect(kept.slice(0, 2)).toStrictEqual(older.slice(1));
    expect(kept[2]).toMatch(/-demo-0001-a\.db$/u);
    expect(kept[3]).toBe('notes.txt');
    expect(logger.lines).toMatchObject([
      {},
      { message: 'backed up the database before migrating', removed: older.slice(0, 1) },
      {},
    ]);
  });

  test('takes no backup of a new database or of one already up to date', ({
    expect,
    tempDir,
    logger,
  }) => {
    const location = path.join(tempDir, 'beuve.db');
    for (let run = 0; run < 2; run += 1) {
      okValueFrom(
        openAppDatabase({ location, logger: logger.logger, migrations: migrationList() }),
      ).close();
    }
    expect(readdirSync(tempDir)).not.toContain('backups');
  });
});
