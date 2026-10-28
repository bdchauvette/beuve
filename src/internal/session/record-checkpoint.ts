import type { Checkpoint, CheckpointId, CommitSha, Session, SessionDeps } from './session.ts';
import { systemSessionDeps } from './system-session-deps.ts';

/**
 * Records that the reviewer has reviewed up to `reviewedSha`, usually the head they were
 * shown (which may be older than `session.headSha` if commits arrived meanwhile).
 */
export function recordCheckpoint(
  session: Session,
  reviewedSha: CommitSha,
  deps: SessionDeps = systemSessionDeps,
): { readonly session: Session; readonly checkpoint: Checkpoint } {
  const checkpoint: Checkpoint = {
    id: deps.newId() as CheckpointId,
    sessionId: session.id,
    commitSha: reviewedSha,
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
