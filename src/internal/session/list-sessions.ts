import type { DatabaseSync } from 'node:sqlite';

import type { Result } from '#x/result/result.ts';

import { selectSessions } from './select-sessions.ts';
import type { Session, SessionError } from './session.ts';

/** All sessions, most recently active first, each with its derived review state. */
export function listSessions(
  db: DatabaseSync,
): Result<Session[], Extract<SessionError, { kind: 'corrupt-row' }>> {
  return selectSessions(db, '1 = 1');
}
