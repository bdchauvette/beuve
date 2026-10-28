import { css, html, LitElement } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { zoneStyles } from './zone-styles.ts';

/** Zone 2: the semantic diff stream. Diff cards arrive with `@pierre/diffs` in Phase 2. */
@customElement('beuve-diff-stream')
export class BeuveDiffStream extends LitElement {
  static override styles = [
    zoneStyles,
    css`
      :host {
        background: var(--beuve-bg);
      }

      .body {
        display: grid;
        place-items: center;
      }

      .welcome {
        max-width: 420px;
        text-align: center;
      }

      .welcome h1 {
        margin: 0 0 var(--beuve-space-2);
        font-size: 20px;
        font-weight: 600;
      }

      .welcome p {
        margin: 0 0 var(--beuve-space-3);
        color: var(--beuve-text-muted);
      }

      .note {
        display: inline-block;
        padding: var(--beuve-space-1) var(--beuve-space-3);
        border: 1px solid var(--beuve-border);
        border-radius: var(--beuve-radius);
        background: var(--beuve-surface);
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) accessor focused = false;

  /** What `session:list` said, shown until sessions can be opened. */
  @property() accessor sessionNote = 'Loading sessions…';

  override render(): TemplateResult {
    return html`
      <header>Diff stream</header>
      <div class="body">
        <div class="welcome">
          <h1>No review session open</h1>
          <p>
            Diff cards ordered by call-graph logic appear here, with interdiffs between revisions
            and ImpactGate banners.
          </p>
          <span class="note">${this.sessionNote}</span>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-diff-stream': BeuveDiffStream;
  }
}
