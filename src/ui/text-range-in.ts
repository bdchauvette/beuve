import type { LinkColumns } from './link-offsets-in.ts';

/** The DOM range over `offsets` of the element's text, which may span several text nodes. */
export function textRangeIn(element: HTMLElement, offsets: LinkColumns): Range | undefined {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = element.ownerDocument.createRange();
  let before = 0;
  let isStartSet = false;
  let node = walker.nextNode();
  while (node !== null) {
    const { length } = node.textContent ?? '';
    if (!isStartSet && offsets.start < before + length) {
      range.setStart(node, offsets.start - before);
      isStartSet = true;
    }
    if (isStartSet && offsets.end <= before + length) {
      range.setEnd(node, offsets.end - before);
      return range;
    }
    before += length;
    node = walker.nextNode();
  }
  return undefined;
}
