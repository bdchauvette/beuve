import type { DatabaseSync } from 'node:sqlite';

import type { UraVerdictChoice } from './ura-verdict-choice.ts';

/** The session's stored verdict choice; empty when the reviewer never chose or chose the derived one. */
export function readVerdictChoice(db: DatabaseSync, sessionId: string): UraVerdictChoice {
  const row = db
    .prepare('SELECT verdict, cleared_reason FROM ura_verdict_choices WHERE session_id = ?;')
    .get(sessionId);
  if (row === undefined) {
    return {};
  }
  const { verdict, cleared_reason: reason } = row;
  const isVerdict = verdict === 'approve' || verdict === 'request-changes' || verdict === 'comment';
  return {
    ...(isVerdict && { chosen: verdict }),
    ...(reason === 'blocker-staged' && { cleared: reason }),
  };
}
