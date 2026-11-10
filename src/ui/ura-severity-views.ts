import type { UraSeverityView } from '#contract/ipc-contract.ts';

/**
 * Every note label in the order the composer and the dock offer them: the labels reviewers reach
 * for most first, then the rarer Conventional Comments ones (ADR 0131).
 */
export const uraSeverityViews: readonly UraSeverityView[] = [
  'issue',
  'suggestion',
  'question',
  'nitpick',
  'thought',
  'smell',
  'praise',
  'note',
  'todo',
  'chore',
  'typo',
  'polish',
  'quibble',
];
