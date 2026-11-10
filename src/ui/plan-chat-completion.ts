/** What a key does to the chat input's open completion list (ADR 0127). */
export type ChatCompletionStep =
  | { readonly kind: 'highlight'; readonly index: number }
  | { readonly kind: 'choose'; readonly index: number }
  | { readonly kind: 'dismiss' };

/** A key pressed in the chat input while its completion list shows `count` commands. */
export interface ChatCompletionKey {
  readonly key: string;
  readonly count: number;
  /** The highlighted command, or `undefined` while none is. */
  readonly highlighted: number | undefined;
}

/**
 * ↓ and ↑ move the highlight, wrapping; Tab chooses the highlighted command, or the first; Enter
 * chooses the highlighted one, and with none highlighted it sends what was typed, as it does with
 * the list closed; Escape closes the list. `undefined`: the key is the input's own. Pure.
 */
export function planChatCompletion({
  key,
  count,
  highlighted,
}: ChatCompletionKey): ChatCompletionStep | undefined {
  if (count === 0) {
    return undefined;
  }
  switch (key) {
    case 'ArrowDown': {
      return { kind: 'highlight', index: ((highlighted ?? -1) + 1) % count };
    }
    case 'ArrowUp': {
      return { kind: 'highlight', index: ((highlighted ?? 0) - 1 + count) % count };
    }
    case 'Tab': {
      return { kind: 'choose', index: highlighted ?? 0 };
    }
    case 'Enter': {
      if (highlighted === undefined) {
        return undefined;
      }
      return { kind: 'choose', index: highlighted };
    }
    case 'Escape': {
      return { kind: 'dismiss' };
    }
    default: {
      return undefined;
    }
  }
}
