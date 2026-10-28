import type { DatabaseSync } from 'node:sqlite';

import type { Result } from '#pkg/result/result.ts';

import { selectSessions } from './select-sessions.ts';
import type { Session, SessionError, SessionSource } from './session.ts';

/** Finds the session already reviewing `source`, so it can be resumed instead of duplicated. */
export function findSessionBySource(
  db: DatabaseSync,
  source: SessionSource,
): Result<Session | undefined, Extract<SessionError, { kind: 'corrupt-row' }>> {
  const found =
    source.kind === 'local'
      ? selectSessions(
          db,
          "s.kind = 'local' AND s.repo_path = ? AND s.base_ref = ? AND s.head_ref = ?",
          [source.repoPath, source.baseRef, source.headRef],
        )
      : selectSessions(
          db,
          "s.kind = 'github-pull-request' AND s.repo_path = ? AND s.owner = ? AND s.repo = ? AND s.pr_number = ?",
          [source.repoPath, source.owner, source.repo, source.number],
        );
  return found.ok ? { ok: true, value: found.value[0] } : found;
}
