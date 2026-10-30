import type { InlineSpan } from './parse-markdown-subset.ts';

/** A DOM node for one inline span of untrusted Markdown: only text and `code`/`strong`/`em` elements. */
export function createInlineNode(span: InlineSpan): Node {
  switch (span.kind) {
    case 'text': {
      return document.createTextNode(span.text);
    }
    case 'code': {
      return inlineElement('code', span.text);
    }
    case 'strong': {
      return inlineElement('strong', span.text);
    }
    case 'emphasis': {
      return inlineElement('em', span.text);
    }
  }
}

function inlineElement(tag: 'code' | 'strong' | 'em', text: string): HTMLElement {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}
