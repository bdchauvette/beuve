/** A `<span>`'s class and its text. */
export interface TextSpanParts {
  readonly className: string;
  readonly text: string;
}

/** A `<span>` holding `text` as a text node, never markup. */
export function createTextSpan({ className, text }: TextSpanParts): HTMLElement {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}
