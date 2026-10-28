import type { CommitSha, Session, SessionDeps } from './session.ts';
import { systemSessionDeps } from './system-session-deps.ts';

/** Moves the session to a new head (commits pushed, rebased or amended). Same head is a no-op. */
export function advanceHead(
  session: Session,
  headSha: CommitSha,
  deps: Pick<SessionDeps, 'now'> = systemSessionDeps,
): Session {
  return headSha === session.headSha
    ? session
    : { ...session, headSha, updatedAt: deps.now().toISOString() };
}
