/**
 * The chat input's placeholder; short enough to fit the narrowest sidebar without clipping a
 * word. While an answer runs, what is sent waits in the queue (ADR 0057).
 */
export function describeChatPlaceholder(isAnswering: boolean): string {
  if (isAnswering) {
    return 'Ask; it waits its turn';
  }
  return 'Ask, or / for commands';
}
