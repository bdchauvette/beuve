import type { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { openDatabase } from '#pkg/sqlite/open-database.ts';
import { runMigrations } from '#pkg/sqlite/run-migrations.ts';

import { sessionMigrations } from './session-migrations.ts';

const id = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const checkpointId = '00000000-0000-4000-8000-00000000000c';
const sha = 'a'.repeat(40);
const time = '2026-10-28T12:00:00.000Z';

describe('sessionMigrations', () => {
  it('uses session-prefixed ids and applies idempotently', () => {
    const db = openDatabase(':memory:');
    expect(runMigrations(db, sessionMigrations)).toEqual(['session-0001-initial']);
    expect(runMigrations(db, sessionMigrations)).toEqual([]);
  });

  it('accepts a valid row of each kind', () => {
    const db = setup();
    expect(() => {
      insertLocal(db, {});
      insertPull(db, { id: otherId });
    }).not.toThrow();
  });

  it.each<[string, Record<string, unknown>]>([
    ['an unknown kind', { kind: 'gitlab' }],
    ['a short sha', { head_sha: 'abc' }],
    ['an uppercase sha', { head_sha: 'A'.repeat(40) }],
    ['a non-UTC timestamp', { created_at: '2026-10-28T12:00:00+01:00' }],
    ['a missing head ref', { head_ref: undefined }],
    ['a pull request field on a local session', { pr_number: 3 }],
    ['a host', { host: 'github.com' }],
  ])('rejects a local session with %s', (_label, overrides) => {
    expect(() => {
      insertLocal(setup(), overrides);
    }).toThrow('CHECK constraint failed');
  });

  it.each<[string, Record<string, unknown>]>([
    ['a missing owner', { owner: undefined }],
    ['a non-positive number', { pr_number: 0 }],
    ['a head ref', { head_ref: 'feature' }],
    ['an uppercase host', { host: 'GitHub.com' }],
    ['a host with a scheme', { host: 'https://github.com' }],
  ])('rejects a pull request session with %s', (_label, overrides) => {
    expect(() => {
      insertPull(setup(), overrides);
    }).toThrow('CHECK constraint failed');
  });

  it('rejects text in the integer column (STRICT)', () => {
    expect(() => {
      insertPull(setup(), { pr_number: 'seven' });
    }).toThrow('cannot store TEXT value in INTEGER column');
  });

  it('rejects a second session for the same change', () => {
    const db = setup();
    insertLocal(db, {});
    expect(() => {
      insertLocal(db, { id: otherId });
    }).toThrow('UNIQUE constraint failed');
  });

  it('rejects checkpoints for unknown sessions and cascades deletes', () => {
    const db = setup();
    const insertCheckpoint = (): void => {
      db.prepare('INSERT INTO checkpoints VALUES (?, ?, ?, ?, ?);').run(
        checkpointId,
        id,
        sha,
        sha,
        time,
      );
    };
    expect(() => {
      insertCheckpoint();
    }).toThrow('FOREIGN KEY constraint failed');
    insertLocal(db, {});
    insertCheckpoint();
    db.prepare('DELETE FROM sessions;').run();
    expect(db.prepare('SELECT count(*) AS n FROM checkpoints;').get()).toEqual({ n: 0 });
  });
});

describe('checkpoints', () => {
  it('requires a full base sha', () => {
    const db = setup();
    insertLocal(db, {});
    expect(() => {
      db.prepare('INSERT INTO checkpoints VALUES (?, ?, ?, ?, ?);').run(
        checkpointId,
        id,
        'abc',
        sha,
        time,
      );
    }).toThrow('CHECK constraint failed');
  });
});

describe('pull request hosts', () => {
  it('keys pull requests by host', () => {
    const db = setup();
    insertPull(db, {});
    expect(() => {
      insertPull(db, { id: checkpointId, host: 'ghe.example.com' });
    }).not.toThrow();
    expect(() => {
      insertPull(db, { id: otherId });
    }).toThrow('UNIQUE constraint failed');
  });
});

function setup(): DatabaseSync {
  const db = openDatabase(':memory:');
  runMigrations(db, sessionMigrations);
  return db;
}

function insertLocal(db: DatabaseSync, overrides: Record<string, unknown>): void {
  insert(db, {
    id,
    kind: 'local',
    repo_path: '/repo',
    base_ref: 'main',
    head_ref: 'feature',
    head_sha: sha,
    created_at: time,
    updated_at: time,
    ...overrides,
  });
}

function insertPull(db: DatabaseSync, overrides: Record<string, unknown>): void {
  insert(db, {
    id,
    kind: 'github-pull-request',
    repo_path: '/repo',
    base_ref: 'main',
    owner: 'acme',
    repo: 'beuve',
    pr_number: 7,
    host: 'github.com',
    head_sha: sha,
    created_at: time,
    updated_at: time,
    ...overrides,
  });
}

function insert(db: DatabaseSync, row: Record<string, unknown>): void {
  const entries = Object.entries(row).filter(([, value]) => value !== undefined);
  const columns = entries.map(([column]) => column).join(', ');
  const placeholders = entries.map(() => '?').join(', ');
  db.prepare(`INSERT INTO sessions (${columns}) VALUES (${placeholders});`).run(
    ...entries.map(([, value]) => value as string | number),
  );
}
