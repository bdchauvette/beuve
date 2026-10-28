import type { IpcError } from '#contract/ipc-contract.ts';
import { advanceHead } from '#internal/session/advance-head.ts';
import type { CommitSha, Session } from '#internal/session/session.ts';
import { updateSessionHead } from '#internal/session/update-session-head.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import type { SessionContext } from '../sessions/session-context.ts';
import { sessionFailure } from '../sessions/session-failure.ts';

/** Stores a pull request session's new head and tells `onHeadMoved`; the same head is a no-op. */
export function moveSessionHead(
  context: SessionContext,
  session: Session,
  headSha: CommitSha,
): Result<Session, IpcError> {
  const advanced = advanceHead(session, headSha, context.deps);
  if (advanced === session) {
    return ok(session);
  }
  const saved = updateSessionHead(context.db, advanced);
  if (!saved.ok) {
    return sessionFailure(context.logger, saved.error);
  }
  context.onHeadMoved?.(advanced.id, advanced.headSha);
  return ok(advanced);
}
