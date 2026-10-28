import type { DatabaseSync } from 'node:sqlite';

import { readVerdictChoice } from './read-verdict-choice.ts';
import type { SessionId } from './ura-item.ts';
import type { UraSeverity } from './ura-severities.ts';
import type { UraVerdictChoice } from './ura-verdict-choice.ts';
import { writeVerdictChoice } from './write-verdict-choice.ts';

/**
 * The session's verdict choice after checking it still holds against the staged severities: a
 * stored approval with a blocker staged is dropped (and remembered as cleared) so no reader ever
 * sees an impossible verdict. Call it after anything that can stage a blocker, and on every read.
 */
export function settleVerdictChoice(
  db: DatabaseSync,
  sessionId: SessionId,
  stagedSeverities: readonly UraSeverity[],
  now: Date,
): UraVerdictChoice {
  const choice = readVerdictChoice(db, sessionId);
  if (choice.chosen !== 'approve' || !stagedSeverities.includes('blocker')) {
    return choice;
  }
  const cleared: UraVerdictChoice = { cleared: 'blocker-staged' };
  writeVerdictChoice(db, sessionId, cleared, now);
  return cleared;
}
