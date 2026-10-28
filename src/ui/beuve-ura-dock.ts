import { css, html, LitElement } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { zoneStyles } from './zone-styles.ts';

/** Zone 3: the Universal Review Artifact staging dock. */
@customElement('beuve-ura-dock')
export class BeuveUraDock extends LitElement {
  static override styles = [
    zoneStyles,
    css`
      :host {
        border-left: 1px solid var(--beuve-border);
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) accessor focused = false;

  override render(): TemplateResult {
    return html`
      <header>Review dock</header>
      <div class="body">
        <section>
          <h2>Staged</h2>
          <p class="empty">
            Nothing staged. <kbd>m</kbd> stages a hunk with a severity, note or patch.
          </p>
        </section>
        <section>
          <h2>Export</h2>
          <p class="empty">Send the review to a GitHub PR or back to Claude Code over MCP.</p>
        </section>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-ura-dock': BeuveUraDock;
  }
}
