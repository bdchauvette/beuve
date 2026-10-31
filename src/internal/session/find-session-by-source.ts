import type { DatabaseSync } from 'node:sqlite';

import type { Result } from '#x/result/result.ts';

import { selectSessions } from './select-sessions.ts';
import type { Session, SessionError, SessionSource } from './session.ts';

/** Finds the session already reviewing `source`, so it can be resumed instead of duplicated. */
export function findSessionBySource(
  db: DatabaseSync,
  source: SessionSource,
): Result<Session | undefined, Extract<SessionError, { kind: 'corrupt-row' }>> {
  const found = sessionsReviewing(db, source);
  if (found.ok) {
    return { ok: true, value: found.value[0] };
  }
  return found;
}

function sessionsReviewing(
  db: DatabaseSync,
  source: SessionSource,
): Result<Session[], Extract<SessionError, { kind: 'corrupt-row' }>> {
  if (source.kind === 'local') {
    return selectSessions(
      db,
      "s.kind = 'local' AND s.repo_path = ? AND s.base_ref = ? AND s.head_ref = ?",
      [source.repoPath, source.baseRef, source.headRef],
    );
  }
  return selectSessions(
    db,
    "s.kind = 'github-pull-request' AND s.repo_path = ? AND s.host = ? AND s.owner = ? AND s.repo = ? AND s.pr_number = ?",
    [source.repoPath, source.host, source.owner, source.repo, source.number],
  );
}
