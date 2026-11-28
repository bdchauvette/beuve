import { html } from 'lit';
import type { TemplateResult } from 'lit';

import { parseInlineTitle } from './parse-inline-title.ts';
import type { InlineSpan } from './parse-markdown-subset.ts';

/**
 * A one-line title's inline Markdown (`parseInlineTitle`) as Lit template parts: inline code as
 * `<code>`, bold as `<strong>`, italics as `<em>`, the rest as text. The caller styles `code`.
 */
export function renderInlineTitle(title: string): (TemplateResult | string)[] {
  return parseInlineTitle(title).map((span) => renderInlineSpan(span));
}

function renderInlineSpan(span: InlineSpan): TemplateResult | string {
  switch (span.kind) {
    case 'text': {
      return span.text;
    }
    case 'code': {
      return html`<code>${span.text}</code>`;
    }
    case 'strong': {
      return html`<strong>${span.text}</strong>`;
    }
    case 'emphasis': {
      return html`<em>${span.text}</em>`;
    }
  }
}
