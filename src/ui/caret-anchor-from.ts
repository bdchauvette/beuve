import type { HoverAnchor } from './place-hover-card.ts';

/** A box in viewport coordinates, as `getBoundingClientRect` gives it. */
export interface ViewportBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** A character's box in a text field, and the field's border box. */
export interface CaretBoxes {
  readonly field: ViewportBox;
  readonly character: ViewportBox;
}

/**
 * The hover anchor of a character in a text field: its start and its line's top and bottom. A
 * character scrolled out of the field is held at the field's edge, so what is placed by it stays
 * beside the field. Pure.
 */
export function caretAnchorFrom({ field, character }: CaretBoxes): HoverAnchor {
  const clampX = (x: number): number => {
    return Math.min(Math.max(x, field.left), field.right);
  };
  const clampY = (y: number): number => {
    return Math.min(Math.max(y, field.top), field.bottom);
  };
  return {
    x: clampX(character.left),
    top: clampY(character.top),
    bottom: clampY(character.bottom),
  };
}
