import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import { isUuid } from './is-uuid.ts';
import type { SessionError, SessionId } from './session.ts';

/** Validates an untrusted session id (e.g. from IPC). */
export function parseSessionId(
  value: string,
): Result<SessionId, Extract<SessionError, { kind: 'invalid-session-id' }>> {
  return isUuid(value) ? ok(value as SessionId) : err({ kind: 'invalid-session-id', value });
}
