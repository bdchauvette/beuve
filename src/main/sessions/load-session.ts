import type { IpcError } from '#contract/ipc-contract.ts';
import { findSession } from '#internal/session/find-session.ts';
import { parseSessionId } from '#internal/session/parse-session-id.ts';
import type { Session } from '#internal/session/session.ts';
import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import type { SessionContext } from './session-context.ts';
import { sessionFailure } from './session-failure.ts';

/** Loads the session an untrusted id names, or `not-found`. */
export function loadSession(context: SessionContext, sessionId: string): Result<Session, IpcError> {
  const id = parseSessionId(sessionId);
  if (!id.ok) {
    return sessionFailure(context.logger, id.error);
  }
  const found = findSession(context.db, id.value);
  if (!found.ok) {
    return sessionFailure(context.logger, found.error);
  }
  return found.value === undefined
    ? err({ code: 'not-found', message: 'no such session' })
    : ok(found.value);
}
