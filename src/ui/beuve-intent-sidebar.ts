import { css, html, LitElement } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { zoneStyles } from './zone-styles.ts';

/** Zone 1: requirements mapped to hunks, and the package-aware radar tree (Phase 2). */
@customElement('beuve-intent-sidebar')
export class BeuveIntentSidebar extends LitElement {
  static override styles = [
    zoneStyles,
    css`
      :host {
        border-right: 1px solid var(--beuve-border);
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) accessor focused = false;

  override render(): TemplateResult {
    return html`
      <header>Intent</header>
      <div class="body">
        <section>
          <h2>Requirements</h2>
          <p class="empty">
            Requirements from the PR description or agent prompt appear here, mapped to hunks.
            Unmapped changes are flagged as scope creep.
          </p>
        </section>
        <section>
          <h2>Files</h2>
          <p class="empty">
            Package-aware tree with ImpactGate percentiles. <kbd>f</kbd> toggles diff-only mode.
          </p>
        </section>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-intent-sidebar': BeuveIntentSidebar;
  }
}
