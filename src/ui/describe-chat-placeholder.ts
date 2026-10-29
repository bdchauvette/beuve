/** The chat input's placeholder; short enough to fit the narrowest sidebar without clipping a word. */
export function describeChatPlaceholder(isAnswering: boolean): string {
  return isAnswering ? 'Answering… one at a time' : 'Ask, or / for commands';
}
