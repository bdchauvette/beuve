/** Where a pointer is, in the viewport's coordinates (a `MouseEvent` has both). */
export interface PointerPoint {
  readonly clientX: number;
  readonly clientY: number;
}

/**
 * The UTF-16 offset into `element`'s text of the character under the pointer, 0 when it is over
 * none. The highlighter merges neighboring text of one color into a single token span, so a click
 * only tells which span it landed in; this finds the character inside it.
 */
export function characterOffsetAt(element: HTMLElement, point: PointerPoint): number {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = element.ownerDocument.createRange();
  let before = 0;
  let node = walker.nextNode();
  while (node !== null) {
    const { length } = node.textContent ?? '';
    for (let index = 0; index < length; index += 1) {
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      const box = range.getBoundingClientRect();
      if (point.clientX >= box.left && point.clientX < box.right) {
        return before + index;
      }
    }
    before += length;
    node = walker.nextNode();
  }
  return 0;
}
