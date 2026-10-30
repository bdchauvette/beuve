import type { DatabaseSync } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { SessionError, UnreviewedSession } from './session.ts';
import { sqliteErrorCode } from './sqlite-error-code.ts';

const uniqueViolation = 2067;

/** Persists a new session. Fails if a session for the same change already exists. */
export function insertSession(
  db: DatabaseSync,
  session: UnreviewedSession,
): Result<void, Extract<SessionError, { kind: 'duplicate-session' }>> {
  const { source } = session;
  const common = [session.id, source.repoPath, source.baseRef, session.headSha] as const;
  const timestamps = [session.createdAt, session.updatedAt] as const;
  try {
    if (source.kind === 'local') {
      db.prepare(
        `INSERT INTO sessions (id, kind, repo_path, base_ref, head_sha, head_ref, created_at, updated_at)
         VALUES (?, 'local', ?, ?, ?, ?, ?, ?);`,
      ).run(...common, source.headRef, ...timestamps);
    } else {
      db.prepare(
        `INSERT INTO sessions (id, kind, repo_path, base_ref, head_sha, host, owner, repo, pr_number,
                               created_at, updated_at)
         VALUES (?, 'github-pull-request', ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      ).run(...common, source.host, source.owner, source.repo, source.number, ...timestamps);
    }
  } catch (error: unknown) {
    if (sqliteErrorCode(error) === uniqueViolation && isSourceConflict(error)) {
      return err({ kind: 'duplicate-session', source });
    }
    throw error;
  }
  return ok(undefined);
}

function isSourceConflict(error: unknown): boolean {
  return error instanceof Error && !error.message.includes('sessions.id');
}
