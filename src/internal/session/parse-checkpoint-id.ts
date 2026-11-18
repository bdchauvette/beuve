import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { isUuid } from '#x/text/is-uuid.ts';
import type { CheckpointId, SessionError } from './session.ts';

/** Validates an untrusted checkpoint id (e.g. from IPC); one that is not a UUID names none. */
export function parseCheckpointId(
  value: string,
): Result<CheckpointId, Extract<SessionError, { kind: 'checkpoint-not-found' }>> {
  if (isUuid(value)) {
    return ok(value as CheckpointId);
  }
  return err({ kind: 'checkpoint-not-found', checkpointId: value });
}
