import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { displayIcon } from './display-icon.ts';
import { buttonStyles } from './primitives/button-styles.ts';

/**
 * The window's top bar: the name of the open review, which opens the Open dialog, an icon-only
 * Reload beside it while a review is open (ADR 0145), and the command palette's search button.
 * The bar drags the window; its buttons do not. Emits `beuve-titlebar-open`, `beuve-titlebar-reload` and
 * `beuve-titlebar-search`.
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

      .reload {
        flex: none;
      }

      .reload[aria-busy='true'] svg {
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        to {
          rotate: 1turn;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .reload[aria-busy='true'] svg {
          animation: none;
        }
      }

      .spacer {
        flex: 1;
      }
    `,
  ];

  private readonly open = (): void => {
    this.dispatchEvent(new CustomEvent('beuve-titlebar-open', { bubbles: true, composed: true }));
  };

  private readonly reload = (): void => {
    this.dispatchEvent(new CustomEvent('beuve-titlebar-reload', { bubbles: true, composed: true }));
  };

  private readonly search = (): void => {
    this.dispatchEvent(new CustomEvent('beuve-titlebar-search', { bubbles: true, composed: true }));
  };

  /** The open review's name, or the placeholder when none is open. */
  @property() accessor label = '';

  /** The tooltip of the name button, with its shortcut. */
  @property() accessor openTitle = '';

  /** The tooltip of the reload button, with its shortcut. */
  @property() accessor reloadTitle = '';

  /** Whether a review is open, so Reload shows. */
  @property({ type: Boolean }) accessor canReload = false;

  /** Whether the review is reloading: Reload spins its glyph and waits. */
  @property({ type: Boolean }) accessor reloading = false;

  /** The tooltip of the search button, with its shortcut. */
  @property() accessor searchTitle = '';

  /** `process.platform`; on macOS the bar leaves room for the window buttons. */
  @property({ reflect: true }) accessor platform = '';

  private renderReload(): TemplateResult {
    return html`<button
      type="button"
      class="button icon reload"
      aria-label="Reload Review"
      title=${this.reloadTitle}
      aria-busy=${this.reloading ? 'true' : 'false'}
      ?disabled=${this.reloading}
      @click=${this.reload}
    >
      ${displayIcon('refresh')}
    </button>`;
  }

  protected override render(): TemplateResult {
    return html`<span class="brand">beuve</span>
      <button class="button quiet" type="button" title=${this.openTitle} @click=${this.open}>
        ${this.label}
      </button>
      ${this.canReload ? this.renderReload() : nothing}
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
