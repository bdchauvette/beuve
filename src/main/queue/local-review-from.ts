import type { QueueLocalReviewView } from '#contract/ipc-contract.ts';
import type { Session } from '#internal/session/session.ts';

/** What the local review state reads: the matching session, its marks and the forge's head. */
export interface LocalReviewInput {
  readonly session: Session | undefined;
  /** Files marked reviewed in that session. */
  readonly markedFiles: number;
  /** The item's head as GitHub reports it; the session's own head when unknown. */
  readonly headSha: string | undefined;
}

/**
 * How far beuve's own review of a queue item got (ADR 0113): never opened; opened with nothing
 * marked; files marked but no checkpoint; a checkpoint on the current head; or a checkpoint and
 * commits since. The head is the forge's, so new commits show before the session is opened. Pure.
 */
export function localReviewFrom({
  session,
  markedFiles,
  headSha,
}: LocalReviewInput): QueueLocalReviewView {
  if (session === undefined) {
    return { state: 'none' };
  }
  const known = { sessionId: session.id, markedFiles };
  if (session.review.kind === 'reviewed') {
    const current = headSha ?? session.headSha;
    if (session.review.checkpoint.headSha === current) {
      return { state: 'reviewed', ...known };
    }
    return { state: 'new-commits', ...known };
  }
  if (markedFiles > 0) {
    return { state: 'partial', ...known };
  }
  return { state: 'opened', ...known };
}
