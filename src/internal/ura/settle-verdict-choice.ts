import type { DatabaseSync } from 'node:sqlite';

import { readVerdictChoice } from './read-verdict-choice.ts';
import type { SessionId } from './ura-item.ts';
import type { UraSeverity } from './ura-severities.ts';
import type { UraVerdictChoice } from './ura-verdict-choice.ts';
import { writeVerdictChoice } from './write-verdict-choice.ts';

/**
 * The session's verdict choice after checking it still holds: a choice made at another head than
 * `headSha` no longer applies (ADR 0045), and a stored approval with a blocker staged is
 * impossible (ADR 0029). Either is dropped and remembered as cleared, so no reader ever sees a
 * stale or impossible verdict. Call it after anything that can stage a blocker or move the head,
 * and on every read.
 */
export function settleVerdictChoice(
  db: DatabaseSync,
  sessionId: SessionId,
  headSha: string,
  stagedSeverities: readonly UraSeverity[],
  now: Temporal.Instant,
): UraVerdictChoice {
  const choice = readVerdictChoice(db, sessionId);
  if (choice.chosen === undefined) {
    return choice;
  }
  const isHeadMoved = choice.headSha !== headSha;
  if (!isHeadMoved && (choice.chosen !== 'approve' || !stagedSeverities.includes('blocker'))) {
    return choice;
  }
  const cleared: UraVerdictChoice = { cleared: isHeadMoved ? 'head-moved' : 'blocker-staged' };
  writeVerdictChoice(db, sessionId, cleared, now);
  return cleared;
}
