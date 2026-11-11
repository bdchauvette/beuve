import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

import { chatMigrations } from '#internal/chat/chat-migrations.ts';
import { githubMigrations } from '#internal/github/github-migrations.ts';
import { reviewEditsMigrations } from '#internal/review-edits/review-edits-migrations.ts';
import { sessionMigrations } from '#internal/session/session-migrations.ts';
import { setupMigrations } from '#internal/setup/setup-migrations.ts';
import { uraMigrations } from '#internal/ura/ura-migrations.ts';
import { openDatabase } from '#sqlite/open-database.ts';
import { runMigrations } from '#sqlite/run-migrations.ts';
import type { Migration } from '#sqlite/run-migrations.ts';

import { appMigrations } from './app-migrations.ts';
import { openAppDatabase } from './open-app-database.ts';
import { test } from '../testing/test.ts';

test('never edits a migration that has shipped; a schema change is a new one', ({ expect }) => {
  expect(
    Object.fromEntries(
      appMigrations.map((migration) => {
        return [migration.id, fingerprintOf(migration)];
      }),
    ),
  ).toStrictEqual(shippedMigrations());
});

test.for(schemaFixtures())(
  'upgrading %s builds the schema a fresh install builds and keeps every row',
  (name, { expect }) => {
    using db = openDatabase(':memory:');
    db.exec(fixtureSql(name));
    const before = rowCounts(db);
    runMigrations(db, appMigrations);
    using fresh = openAppDatabase(':memory:');
    expect(schemaOf(db)).toStrictEqual(schemaOf(fresh));
    expect(appliedIds(db)).toStrictEqual(appMigrations.map(({ id }) => id));
    expect(db.prepare('PRAGMA foreign_key_check;').all()).toStrictEqual([]);
    expect(
      db
        .prepare('PRAGMA integrity_check;')
        .all()
        .map((row) => {
          return row['integrity_check'];
        }),
    ).toStrictEqual(['ok']);
    const kept = keptTableCounts(before, rowCounts(db));
    expect(kept.after).toStrictEqual(kept.before);
  },
);

test.for(schemaFixtures())(
  '%s holds a run of the shipped migrations, is named after its last, and fills every table',
  (name, { expect }) => {
    using db = openDatabase(':memory:');
    db.exec(fixtureSql(name));
    const applied = appliedIds(db);
    expect(applied).toStrictEqual(appMigrations.slice(0, applied.length).map(({ id }) => id));
    expect(`${applied.at(-1) ?? ''}.sql`).toBe(name);
    expect(
      Object.entries(rowCounts(db)).filter(([, count]) => {
        return count === 0;
      }),
    ).toStrictEqual([]);
  },
);

test('has a schema fixture to upgrade', ({ expect }) => {
  expect(schemaFixtures()).not.toStrictEqual([]);
});

test('names each migration after its domain and numbers it once per prefix', ({ expect }) => {
  const misnamed = Object.entries(domainMigrations()).flatMap(([domain, migrations]) => {
    return migrations
      .map(({ id }) => id)
      .filter((id) => {
        return !id.startsWith(`${domain}-`);
      });
  });
  expect(misnamed).toStrictEqual([]);
  const ids = appMigrations.map(({ id }) => id);
  expect(
    ids.filter((id) => {
      return !/^[a-z][a-z-]*-\d{4}-[a-z0-9-]+$/u.test(id);
    }),
  ).toStrictEqual([]);
  const numbers = ids.map((id) => /^.*?-\d{4}/u.exec(id)?.[0]);
  expect(
    numbers.filter((number, index) => {
      return numbers.indexOf(number) !== index;
    }),
  ).toStrictEqual([]);
});

/**
 * Every migration, by id, with a fingerprint of its SQL (ADR 0006 amendment 2026-11-11). Append a
 * new migration's line; never change a line already here, because databases that ran it keep its
 * schema. A function migration is pinned by id only: its compiled text changes with the toolchain.
 */
function shippedMigrations(): Record<string, string> {
  return {
    'session-0001-initial': '8fc7431258c96edb',
    'ura-0001-initial': 'ef3e0595c6f67a89',
    'chat-0001-initial': 'ec7c29ba45f88ad8',
    'chat-0002-message-parts': 'function',
    'github-0001-initial': 'c94acc3c4c21887b',
    'review-edits-0001-initial': '3a3ec7a126f466a8',
    'setup-0001-initial': 'c35af3cb07ed9eb1',
    'trust-0002-drop-grants': 'c63f49d2490a652d',
    'ura-0002-drop-impact-findings': 'e98b3a255e786eda',
  };
}

function fingerprintOf(migration: Migration): string {
  if (typeof migration.up !== 'string') {
    return 'function';
  }
  return createHash('sha256').update(migration.up).digest('hex').slice(0, 16);
}

/**
 * The schema fixtures (ADR 0006 amendment 2026-11-11): a SQL dump of a database as a release left
 * it, named after its last migration, written by `scripts/write-schema-fixture.ts`.
 */
function schemaFixtures(): string[] {
  return readdirSync(fixtureUrl(''))
    .filter((name) => {
      return name.endsWith('.sql');
    })
    .toSorted((a, b) => a.localeCompare(b));
}

function fixtureSql(name: string): string {
  return readFileSync(fixtureUrl(name), 'utf8');
}

function fixtureUrl(name: string): URL {
  return new URL(`testing/schema-fixtures/${name}`, import.meta.url);
}

/** Each table, index, view and trigger, its SQL's whitespace collapsed, by type and name. */
function schemaOf(db: DatabaseSync): string[] {
  return db
    .prepare(
      `SELECT type, name, tbl_name, coalesce(sql, '') AS sql FROM sqlite_schema
       ORDER BY type, name;`,
    )
    .all()
    .map((row) => {
      const sql = String(row['sql']).replaceAll(/\s+/gu, ' ').trim();
      return `${String(row['type'])} ${String(row['name'])} on ${String(row['tbl_name'])}: ${sql}`;
    });
}

function appliedIds(db: DatabaseSync): string[] {
  return db
    .prepare('SELECT id FROM schema_migrations ORDER BY rowid;')
    .all()
    .map((row) => {
      return String(row['id']);
    });
}

/** The number of rows in each table but `schema_migrations`, by name. */
function rowCounts(db: DatabaseSync): Record<string, number> {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name <> 'schema_migrations'
       ORDER BY name;`,
    )
    .all()
    .map((row) => {
      return String(row['name']);
    });
  return Object.fromEntries(
    tables.map((table) => {
      const row = db.prepare(`SELECT count(*) AS count FROM "${table}";`).get();
      return [table, Number(row?.['count'])];
    }),
  );
}

/** Row counts, by table, of the tables an upgrade kept, before and after it. */
interface KeptTableCounts {
  readonly before: Record<string, number>;
  readonly after: Record<string, number>;
}

/** Leaves out the tables a migration added or dropped. */
function keptTableCounts(
  before: Record<string, number>,
  after: Record<string, number>,
): KeptTableCounts {
  const tables = Object.keys(before).filter((table) => {
    return Object.hasOwn(after, table);
  });
  const kept = (counts: Record<string, number>): Record<string, number> => {
    return Object.fromEntries(
      tables.map((table) => {
        return [table, counts[table] ?? 0];
      }),
    );
  };
  return { before: kept(before), after: kept(after) };
}

/** Each domain's migrations by the id prefix they carry. Retired ones keep their old prefix. */
function domainMigrations(): Record<string, readonly Migration[]> {
  return {
    session: sessionMigrations,
    ura: uraMigrations,
    chat: chatMigrations,
    github: githubMigrations,
    'review-edits': reviewEditsMigrations,
    setup: setupMigrations,
  };
}
