import { css, html, LitElement } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { buttonStyles } from './primitives/button-styles.ts';

/**
 * The window's top bar: the name of the open review, which opens the Open dialog, and the
 * command palette's search button. The bar drags the window; its buttons do not. Emits
 * `beuve-titlebar-open` and `beuve-titlebar-search`.
 */
@customElement('beuve-titlebar')
export class BeuveTitlebar extends LitElement {
  static override styles = [
    buttonStyles,
    css`
      :host {
        display: flex;
        align-items: center;
        gap: var(--beuve-space-3);
        padding: 0 var(--beuve-space-4);
        border-block-end: var(--beuve-border-width) solid var(--beuve-border);
        background: var(--beuve-surface-sunken);
        -webkit-app-region: drag;
        user-select: none;
      }

      :host([platform='darwin']) {
        padding-inline-start: var(--beuve-titlebar-traffic-lights);
      }

      .brand {
        font-weight: var(--beuve-font-weight-semibold);
      }

      button {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        -webkit-app-region: no-drag;
      }

      .spacer {
        flex: 1;
      }
    `,
  ];

  private readonly open = (): void => {
    this.dispatchEvent(new CustomEvent('beuve-titlebar-open', { bubbles: true, composed: true }));
  };

  private readonly search = (): void => {
    this.dispatchEvent(new CustomEvent('beuve-titlebar-search', { bubbles: true, composed: true }));
  };

  /** The open review's name, or the placeholder when none is open. */
  @property() accessor label = '';

  /** The tooltip of the name button, with its shortcut. */
  @property() accessor openTitle = '';

  /** The tooltip of the search button, with its shortcut. */
  @property() accessor searchTitle = '';

  /** `process.platform`; on macOS the bar leaves room for the window buttons. */
  @property({ reflect: true }) accessor platform = '';

  protected override render(): TemplateResult {
    return html`<span class="brand">beuve</span>
      <button class="button quiet" type="button" title=${this.openTitle} @click=${this.open}>
        ${this.label}
      </button>
      <span class="spacer"></span>
      <button
        type="button"
        class="button quiet search"
        title=${this.searchTitle}
        @click=${this.search}
      >
        Search or run a command
      </button>`;
  }
}
