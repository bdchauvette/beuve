import type { Checkpoint, CheckpointId, ReviewedRange, Session, SessionDeps } from './session.ts';
import { systemSessionDeps } from './system-session-deps.ts';

/**
 * Records that the reviewer has reviewed `reviewed`: usually the head they were shown (which may
 * be older than `session.headSha` if commits arrived meanwhile) and the fork point it was diffed
 * against.
 */
export function recordCheckpoint(
  session: Session,
  reviewed: ReviewedRange,
  deps: SessionDeps = systemSessionDeps,
): { readonly session: Session; readonly checkpoint: Checkpoint } {
  const checkpoint: Checkpoint = {
    id: deps.newId() as CheckpointId,
    sessionId: session.id,
    baseSha: reviewed.baseSha,
    headSha: reviewed.headSha,
    createdAt: deps.now().toISOString(),
  };
  return {
    session: {
      ...session,
      review: { kind: 'reviewed', checkpoint },
      updatedAt: checkpoint.createdAt,
    },
    checkpoint,
  };
}
