/**
 * The dock's selection (ADR 0143): the notes picked besides the cursor, and the note a Shift
 * range grows from. Empty means only the note under the cursor.
 */
export interface DockSelection {
  readonly selected: readonly string[];
  readonly anchor: string | undefined;
}

/**
 * What the reviewer did: `move` the cursor or click without a modifier (clears), `extend` with
 * Shift (↑/↓ or a click) from the cursor's note to `to`, `toggle` `to` with ⌘/Ctrl+click while
 * the cursor is on `from`, select `all`, or `clear` with Escape.
 */
export type DockGesture =
  | { readonly kind: 'move' }
  | { readonly kind: 'extend'; readonly from: string; readonly to: string }
  | { readonly kind: 'toggle'; readonly from: string; readonly to: string }
  | { readonly kind: 'all' }
  | { readonly kind: 'clear' };

/** A gesture and the dock's notes, in the order the dock shows them. */
export interface DockSelectionStep {
  readonly gesture: DockGesture;
  readonly order: readonly string[];
}

/** The empty selection: only the cursor's note. */
const none: DockSelection = { selected: [], anchor: undefined };

/**
 * The selection after a gesture, as list views do it: Shift selects the range from the anchor
 * (the cursor's note when there is none yet) to the target, ⌘/Ctrl+click adds or removes one note
 * (starting from the cursor's), and a plain move clears it. The selected notes come in dock
 * order; ids no longer in `order` drop out. Pure.
 */
export function dockSelectionAfter(
  selection: DockSelection,
  { gesture, order }: DockSelectionStep,
): DockSelection {
  switch (gesture.kind) {
    case 'move':
    case 'clear': {
      return none;
    }
    case 'all': {
      return { selected: [...order], anchor: selection.anchor ?? order[0] };
    }
    case 'extend': {
      const anchor = selection.anchor ?? gesture.from;
      const from = order.indexOf(anchor);
      const to = order.indexOf(gesture.to);
      if (from === -1 || to === -1) {
        return none;
      }
      return {
        selected: order.slice(Math.min(from, to), Math.max(from, to) + 1),
        anchor,
      };
    }
    case 'toggle': {
      let picked = new Set(selection.selected);
      if (picked.size === 0) {
        picked = new Set([gesture.from]);
      }
      if (picked.has(gesture.to)) {
        picked.delete(gesture.to);
      } else {
        picked.add(gesture.to);
      }
      const selected = order.filter((id) => picked.has(id));
      if (selected.length === 0) {
        return none;
      }
      return { selected, anchor: gesture.to };
    }
  }
}
