import type { CommitSha, Session } from './session.ts';

/** Moves the session to a new head (commits pushed, rebased or amended). Same head is a no-op. */
export function advanceHead(session: Session, headSha: CommitSha): Session {
  if (headSha === session.headSha) {
    return session;
  }
  return {
    ...session,
    headSha,
    updatedAt: Temporal.Now.instant().toString({ fractionalSecondDigits: 3 }),
  };
}
