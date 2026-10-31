import { html } from 'lit';
import type { TemplateResult } from 'lit';

import { revealFormatControls } from '#x/text/reveal-format-controls.ts';

const escape = /(⟨U\+[\dA-F]{4,6}⟩)/u;

/**
 * A repository path (or a label holding one) as the renderer shows it (ADR 0082): every
 * invisible, control or bidi character becomes a visible `⟨U+202E⟩` in a `.format-control` span
 * (`formatControlStyles`), so a name can't hide characters or reorder itself. Put the real path
 * in a `title` beside it. Text without such characters renders as it is.
 */
export function pathText(text: string): TemplateResult {
  const revealed = revealFormatControls(text);
  if (revealed === text) {
    return html`${text}`;
  }
  return html`${revealed.split(escape).map((part, index) => {
    if (index % 2 === 1) {
      return html`<span class="format-control">${part}</span>`;
    }
    return part;
  })}`;
}
