import type { DatabaseSync } from 'node:sqlite';

import { readVerdictChoice } from './read-verdict-choice.ts';
import type { SessionId } from './ura-item.ts';
import type { UraSeverity } from './ura-severities.ts';
import type { UraVerdictChoice } from './ura-verdict-choice.ts';
import { writeVerdictChoice } from './write-verdict-choice.ts';

/** The head the session is at and the severities of its staged items. */
export interface VerdictState {
  readonly headSha: string;
  readonly stagedSeverities: readonly UraSeverity[];
}

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
  { headSha, stagedSeverities }: VerdictState,
): UraVerdictChoice {
  const choice = readVerdictChoice(db, sessionId);
  if (choice.chosen === undefined) {
    return choice;
  }
  const isHeadMoved = choice.headSha !== headSha;
  if (!isHeadMoved && (choice.chosen !== 'approve' || !stagedSeverities.includes('blocker'))) {
    return choice;
  }
  let cleared: UraVerdictChoice = { cleared: 'blocker-staged' };
  if (isHeadMoved) {
    cleared = { cleared: 'head-moved' };
  }
  writeVerdictChoice(db, sessionId, cleared);
  return cleared;
}
