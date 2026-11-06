import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { formatDuration } from '#x/time/format-duration.ts';
import type { DurationStyle } from '#x/time/format-duration.ts';

/**
 * A duration as a `<time datetime="PT…">` (ADR 0115), formatted with `Intl.DurationFormat` in the
 * user's language and balanced up to hours, as `formatDuration` does: `1m 30s`. `format-style` is
 * `narrow` (the default), `short`, `long` or `digital`. Nothing renders for text that is not an
 * ISO 8601 duration.
 */
@customElement('beuve-duration')
export class BeuveDuration extends LitElement {
  static override styles = css`
    :host {
      display: inline;
    }
  `;

  /** An ISO 8601 duration, such as `PT1M30S`. */
  @property() accessor value = '';
  @property({ attribute: 'format-style' }) accessor formatStyle: DurationStyle = 'narrow';

  protected override render(): TemplateResult | typeof nothing {
    let text: string;
    try {
      text = formatDuration(Temporal.Duration.from(this.value), undefined, this.formatStyle);
    } catch {
      return nothing;
    }
    return html`<time datetime=${this.value}>${text}</time>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-duration': BeuveDuration;
  }
}
