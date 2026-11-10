import type { UraVerdict } from './ura-artifact.ts';
import type { UraItemLabel } from './ura-item.ts';
import type { UraSeverity } from './ura-severities.ts';

/**
 * What a label asks of the author when the note is not blocking: `comment` when they have to act
 * or answer, `approve` when the note is optional or asks for nothing (ADR 0131).
 */
const asks: Readonly<Record<UraSeverity, Exclude<UraVerdict, 'request-changes'>>> = {
  issue: 'comment',
  suggestion: 'comment',
  question: 'comment',
  todo: 'comment',
  chore: 'comment',
  typo: 'comment',
  nitpick: 'approve',
  thought: 'approve',
  smell: 'approve',
  praise: 'approve',
  note: 'approve',
  polish: 'approve',
  quibble: 'approve',
};

/**
 * The verdict staged items imply: any blocking note requests changes; an `issue`, `suggestion`,
 * `question`, `todo`, `chore` or `typo` leaves a comment, since the author has to act or answer;
 * the rest (or nothing at all) approve, because they are optional or ask for nothing.
 */
export function deriveUraVerdict(items: readonly UraItemLabel[]): UraVerdict {
  if (items.some((item) => item.blocking)) {
    return 'request-changes';
  }
  if (items.some((item) => asks[item.severity] === 'comment')) {
    return 'comment';
  }
  return 'approve';
}
