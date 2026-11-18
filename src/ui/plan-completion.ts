/** What a key does to a text field's open completion list (ADR 0127, 0144). */
export type CompletionStep =
  | { readonly kind: 'highlight'; readonly index: number }
  | { readonly kind: 'choose'; readonly index: number }
  | { readonly kind: 'dismiss' };

/** A key pressed in a text field while its completion list shows `count` suggestions. */
export interface CompletionKey {
  readonly key: string;
  readonly count: number;
  /** The highlighted suggestion, or `undefined` while none is. */
  readonly highlighted: number | undefined;
}

/**
 * ↓ and ↑ move the highlight, wrapping; Tab chooses the highlighted suggestion, or the first;
 * Enter chooses the highlighted one, and with none highlighted it is the field's own, as it is
 * with the list closed (the chat input sends); Escape closes the list. `undefined`: the key is
 * the field's own. Pure.
 */
export function planCompletion({
  key,
  count,
  highlighted,
}: CompletionKey): CompletionStep | undefined {
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
