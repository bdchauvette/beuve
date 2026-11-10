import type { DatabaseSync } from 'node:sqlite';

import { readVerdictChoice } from './read-verdict-choice.ts';
import type { SessionId } from './ura-item.ts';
import type { UraVerdictChoice } from './ura-verdict-choice.ts';
import { writeVerdictChoice } from './write-verdict-choice.ts';

/** The head the session is at and whether any of its staged items is blocking. */
export interface VerdictState {
  readonly headSha: string;
  readonly isBlockingStaged: boolean;
}

/**
 * The session's verdict choice after checking it still holds: a choice made at another head than
 * `headSha` no longer applies (ADR 0045), and a stored approval with a blocking note staged is
 * impossible (ADR 0029). Either is dropped and remembered as cleared, so no reader ever sees a
 * stale or impossible verdict. Call it after anything that can stage a blocking note or move the head,
 * and on every read.
 */
export function settleVerdictChoice(
  db: DatabaseSync,
  sessionId: SessionId,
  { headSha, isBlockingStaged }: VerdictState,
): UraVerdictChoice {
  const choice = readVerdictChoice(db, sessionId);
  if (choice.chosen === undefined) {
    return choice;
  }
  const isHeadMoved = choice.headSha !== headSha;
  if (!isHeadMoved && (!isBlockingStaged || choice.chosen !== 'approve')) {
    return choice;
  }
  let cleared: UraVerdictChoice = { cleared: 'blocking-staged' };
  if (isHeadMoved) {
    cleared = { cleared: 'head-moved' };
  }
  writeVerdictChoice(db, sessionId, cleared);
  return cleared;
}
