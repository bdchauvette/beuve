import type { UraSeverityView } from '#contract/ipc-contract.ts';

const emoji: Readonly<Record<UraSeverityView, string>> = {
  blocker: '🛑',
  issue: '⚠️',
  question: '❓',
  nit: '⛏️',
  praise: '✨',
};

/** The emoji that marks a note's severity at a glance. */
export function uraSeverityEmoji(severity: UraSeverityView): string {
  return emoji[severity];
}
