import type { UraSeverity } from './ura-severities.ts';

const emoji: Readonly<Record<UraSeverity, string>> = {
  blocker: '🛑',
  issue: '⚠️',
  question: '❓',
  nit: '⛏️',
  praise: '✨',
};

/** The emoji that marks a severity at a glance, in the dock, the diff and posted reviews. */
export function uraSeverityEmoji(severity: UraSeverity): string {
  return emoji[severity];
}
