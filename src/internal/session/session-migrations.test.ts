import type { DatabaseSync } from 'node:sqlite';

import { describe } from 'vitest';

import { runMigrations } from '#sqlite/run-migrations.ts';
import { test as databaseTest } from '#testing/test.ts';

import { sessionMigrations } from './session-migrations.ts';
import { test } from './testing/test.ts';

/** Fixed ids and values for the rows these tests insert by hand. */
interface Row {
  readonly id: string;
  readonly otherId: string;
  readonly checkpointId: string;
  readonly sha: string;
  readonly time: string;
}

describe('sessionMigrations', () => {
  databaseTest('uses session-prefixed ids and applies idempotently', ({ expect, db }) => {
    expect(runMigrations(db, sessionMigrations)).toStrictEqual(['session-0001-initial']);
    expect(runMigrations(db, sessionMigrations)).toStrictEqual([]);
  });

  test('accepts a valid row of each kind', ({ expect, db }) => {
    expect(() => {
      insertLocal(db, {});
      insertPull(db, { id: row().otherId });
    }).not.toThrow();
  });

  test.for<[string, Record<string, unknown>]>([
    ['an unknown kind', { kind: 'gitlab' }],
    ['a short sha', { head_sha: 'abc' }],
    ['an uppercase sha', { head_sha: 'A'.repeat(40) }],
    ['a non-UTC timestamp', { created_at: '2026-10-28T12:00:00+01:00' }],
    ['a missing head ref', { head_ref: undefined }],
    ['a pull request field on a local session', { pr_number: 3 }],
    ['a host', { host: 'github.com' }],
  ])('rejects a local session with %s', ([, overrides], { expect, db }) => {
    expect(() => {
      insertLocal(db, overrides);
    }).toThrow('CHECK constraint failed');
  });

  test.for<[string, Record<string, unknown>]>([
    ['a missing owner', { owner: undefined }],
    ['a non-positive number', { pr_number: 0 }],
    ['a head ref', { head_ref: 'feature' }],
    ['an uppercase host', { host: 'GitHub.com' }],
    ['a host with a scheme', { host: 'https://github.com' }],
  ])('rejects a pull request session with %s', ([, overrides], { expect, db }) => {
    expect(() => {
      insertPull(db, overrides);
    }).toThrow('CHECK constraint failed');
  });

  test('rejects text in the integer column (STRICT)', ({ expect, db }) => {
    expect(() => {
      insertPull(db, { pr_number: 'seven' });
    }).toThrow('cannot store TEXT value in INTEGER column');
  });

  test('rejects a second session for the same change', ({ expect, db }) => {
    insertLocal(db, {});
    expect(() => {
      insertLocal(db, { id: row().otherId });
    }).toThrow('UNIQUE constraint failed');
  });

  test('rejects checkpoints for unknown sessions and cascades deletes', ({ expect, db }) => {
    const { checkpointId, id, sha, time } = row();
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
    expect(db.prepare('SELECT count(*) AS n FROM checkpoints;').get()).toMatchObject({ n: 0 });
  });
});

describe('checkpoints', () => {
  test('requires a full base sha', ({ expect, db }) => {
    const { checkpointId, id, sha, time } = row();
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
  test('keys pull requests by host', ({ expect, db }) => {
    insertPull(db, {});
    expect(() => {
      insertPull(db, { id: row().checkpointId, host: 'ghe.example.com' });
    }).not.toThrow();
    expect(() => {
      insertPull(db, { id: row().otherId });
    }).toThrow('UNIQUE constraint failed');
  });
});

function row(): Row {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    otherId: '00000000-0000-4000-8000-000000000002',
    checkpointId: '00000000-0000-4000-8000-00000000000c',
    sha: 'a'.repeat(40),
    time: '2026-10-28T12:00:00.000Z',
  };
}

function insertLocal(db: DatabaseSync, overrides: Record<string, unknown>): void {
  const { id, sha, time } = row();
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
  const { id, sha, time } = row();
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
