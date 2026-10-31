import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { isUuid } from '#x/text/is-uuid.ts';
import type { SessionError, SessionId } from './session.ts';

/** Validates an untrusted session id (e.g. from IPC). */
export function parseSessionId(
  value: string,
): Result<SessionId, Extract<SessionError, { kind: 'invalid-session-id' }>> {
  if (isUuid(value)) {
    return ok(value as SessionId);
  }
  return err({ kind: 'invalid-session-id', value });
}
