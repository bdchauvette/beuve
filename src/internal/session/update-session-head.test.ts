import { describe, expect, it } from 'vitest';

import { openDatabase } from '#sqlite/open-database.ts';
import { runMigrations } from '#sqlite/run-migrations.ts';

import type { Session, CommitSha, SessionId } from './session.ts';
import { sessionMigrations } from './session-migrations.ts';
import { updateSessionHead } from './update-session-head.ts';

describe('updateSessionHead', () => {
  it('reports an unknown session', () => {
    const db = openDatabase(':memory:');
    runMigrations(db, sessionMigrations);
    const session: Session = {
      id: '00000000-0000-4000-8000-000000000001' as SessionId,
      source: { kind: 'local', repoPath: '/repo', baseRef: 'main', headRef: 'feat' },
      headSha: 'a'.repeat(40) as CommitSha,
      review: { kind: 'unreviewed' },
      createdAt: '2026-10-28T12:00:00.000Z',
      updatedAt: '2026-10-28T12:00:00.000Z',
    };
    expect(updateSessionHead(db, session)).toEqual({
      ok: false,
      error: { kind: 'session-not-found', sessionId: session.id },
    });
  });
});
