import type { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { openDatabase } from '#pkg/sqlite/open-database.ts';
import { runMigrations } from '#pkg/sqlite/run-migrations.ts';

import { createSession } from './create-session.ts';
import { findSessionBySource } from './find-session-by-source.ts';
import { findSession } from './find-session.ts';
import { insertSession } from './insert-session.ts';
import { listSessions } from './list-sessions.ts';
import type {
  CommitSha,
  SessionDeps,
  SessionId,
  SessionSource,
  UnreviewedSession,
} from './session.ts';
import { sessionMigrations } from './session-migrations.ts';

const head = 'a'.repeat(40) as CommitSha;
const local: SessionSource = { kind: 'local', repoPath: '/repo', baseRef: 'main', headRef: 'feat' };
const pull: SessionSource = {
  kind: 'github-pull-request',
  repoPath: '/repo',
  baseRef: 'main',
  host: 'github.com',
  owner: 'acme',
  repo: 'beuve',
  number: 7,
};

describe('insertSession', () => {
  it('round-trips both kinds through findSession, findSessionBySource and listSessions', () => {
    const db = setup();
    const first = make(local, 1);
    const second = make(pull, 2);
    expect(insertSession(db, first)).toEqual({ ok: true, value: undefined });
    expect(insertSession(db, second)).toEqual({ ok: true, value: undefined });

    expect(findSession(db, first.id)).toEqual({ ok: true, value: first });
    expect(findSessionBySource(db, pull)).toEqual({ ok: true, value: second });
    expect(listSessions(db)).toEqual({ ok: true, value: [second, first] });
  });

  it('reports a missing session as undefined', () => {
    const db = setup();
    const missing = '00000000-0000-4000-8000-0000000000ff' as SessionId;
    expect(findSession(db, missing)).toEqual({ ok: true, value: undefined });
    expect(findSessionBySource(db, local)).toEqual({ ok: true, value: undefined });
    expect(findSessionBySource(db, { ...pull, number: 8 })).toEqual({ ok: true, value: undefined });
  });

  it('keeps the same pull request number on two hosts apart', () => {
    const db = setup();
    const enterprise: SessionSource = { ...pull, host: 'ghe.example.com' };
    const first = make(pull, 1);
    const second = make(enterprise, 2);
    expect(insertSession(db, first).ok).toBe(true);
    expect(insertSession(db, second).ok).toBe(true);
    expect(findSessionBySource(db, enterprise)).toEqual({ ok: true, value: second });
    expect(findSessionBySource(db, pull)).toEqual({ ok: true, value: first });
  });

  it('refuses a second session for the same change', () => {
    const db = setup();
    insertSession(db, make(local, 1));
    expect(insertSession(db, make(local, 2))).toEqual({
      ok: false,
      error: { kind: 'duplicate-session', source: local },
    });
    expect(insertSession(db, make({ ...local, headRef: 'other' }, 3)).ok).toBe(true);
  });

  it('throws on an id collision, which is a bug rather than an expected failure', () => {
    const db = setup();
    insertSession(db, make(local, 1));
    expect(() => insertSession(db, make({ ...local, headRef: 'other' }, 1))).toThrow('sessions.id');
  });
});

function setup(): DatabaseSync {
  const db = openDatabase(':memory:');
  runMigrations(db, sessionMigrations);
  return db;
}

function make(source: SessionSource, n: number): UnreviewedSession {
  const deps: SessionDeps = {
    now: (): Date => new Date(Date.UTC(2026, 9, 28, 12, n)),
    newId: (): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  };
  const created = createSession(source, head, deps);
  if (!created.ok) {
    throw new Error('fixture source is invalid');
  }
  return created.value;
}
