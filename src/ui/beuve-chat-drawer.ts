import { css, html, LitElement } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { zoneStyles } from './zone-styles.ts';

/** Zone 4: the read-only Q&A drawer over the worktree, diff hunks and LSP symbols. */
@customElement('beuve-chat-drawer')
export class BeuveChatDrawer extends LitElement {
  static override styles = [
    zoneStyles,
    css`
      :host {
        border-top: 1px solid var(--beuve-border);
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) accessor focused = false;

  override render(): TemplateResult {
    return html`
      <header>Chat <span>· read-only</span></header>
      <div class="body">
        <p class="empty">
          Ask about the change. Answers cite hunks and can be staged as review comments. Arrives in
          Phase 2. <kbd>c</kbd> closes this drawer.
        </p>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-chat-drawer': BeuveChatDrawer;
  }
}
