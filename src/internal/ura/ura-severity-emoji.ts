import type { UraSeverity } from './ura-severities.ts';

const emoji: Readonly<Record<UraSeverity, string>> = {
  issue: '⚠️',
  suggestion: '💡',
  question: '❓',
  nitpick: '⛏️',
  thought: '💭',
  smell: '👃',
  praise: '👏',
  note: 'ℹ️',
  todo: '☑️',
  chore: '🧹',
};

/** The emoji that marks a label at a glance, in the dock, the diff and posted reviews (ADR 0131). */
export function uraSeverityEmoji(severity: UraSeverity): string {
  return emoji[severity];
}
