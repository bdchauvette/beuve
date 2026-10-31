import type { DatabaseSync } from 'node:sqlite';

import type { Result } from '#x/result/result.ts';

import { selectSessions } from './select-sessions.ts';
import type { Session, SessionError, SessionId } from './session.ts';

/** Loads one session with its derived review state; `undefined` if there is none. */
export function findSession(
  db: DatabaseSync,
  id: SessionId,
): Result<Session | undefined, Extract<SessionError, { kind: 'corrupt-row' }>> {
  const found = selectSessions(db, 's.id = ?', [id]);
  if (found.ok) {
    return { ok: true, value: found.value[0] };
  }
  return found;
}
