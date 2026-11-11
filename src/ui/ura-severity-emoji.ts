import type { UraSeverityView } from '#contract/ipc-contract.ts';

const emoji: Readonly<Record<UraSeverityView, string>> = {
  issue: '⚠️',
  suggestion: '💡',
  question: '❓',
  nitpick: '⛏️',
  thought: '💭',
  smell: '👃',
  praise: '🎉',
  note: 'ℹ️',
  todo: '☑️',
  chore: '🧹',
};

/** The emoji that marks a note's label at a glance (ADR 0131). */
export function uraSeverityEmoji(severity: UraSeverityView): string {
  return emoji[severity];
}
