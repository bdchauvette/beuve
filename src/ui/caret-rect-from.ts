import { InputRange } from 'dom-input-range';

import { caretAnchorFrom } from './caret-anchor-from.ts';
import type { HoverAnchor } from './place-hover-card.ts';

/**
 * Where character `offset` of `field` sits, in viewport coordinates: its start and its line's top
 * and bottom (ADR 0145, 0147). Text fields have no range API, so `dom-input-range` lays the
 * field's text out in a hidden clone that copies its styles, size and scroll, and measures the
 * character there. The clone lives only for the measurement. The one importer of
 * `dom-input-range`.
 */
export function caretRectFrom(
  field: HTMLInputElement | HTMLTextAreaElement,
  offset: number,
): HoverAnchor {
  using stack = new DisposableStack();
  const range = new InputRange(field, offset, Math.min(offset + 1, field.value.length));
  const clone = stack.adopt(range.getStyleClone(), (made) => {
    made.disconnect();
  });
  const [character] = range.getClientRects();
  return caretAnchorFrom({
    field: field.getBoundingClientRect(),
    character: character ?? clone.element.getBoundingClientRect(),
  });
}
