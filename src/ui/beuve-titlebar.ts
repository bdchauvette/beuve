import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { displayIcon } from './display-icon.ts';
import { buttonStyles } from './primitives/button-styles.ts';
import { statusDotStyles } from './primitives/status-dot-styles.ts';

/**
 * The window's top bar: the name of the open review, which opens the Open dialog, an icon-only
 * Reload beside it while a review is open (ADR 0146), marked with a dot while polling has found
 * commits the review does not show yet. The bar drags the window; its buttons do not. Emits
 * `beuve-titlebar-open` and `beuve-titlebar-reload`.
 */
@customElement('beuve-titlebar')
export class BeuveTitlebar extends LitElement {
  static override styles = [
    buttonStyles,
    statusDotStyles,
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
        position: relative;
        flex: none;
      }

      .reload .status-dot {
        position: absolute;
        inset-block-start: var(--beuve-space-0-5);
        inset-inline-end: var(--beuve-space-0-5);
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
    `,
  ];

  private readonly open = (): void => {
    this.dispatchEvent(new CustomEvent('beuve-titlebar-open', { bubbles: true, composed: true }));
  };

  private readonly reload = (): void => {
    this.dispatchEvent(new CustomEvent('beuve-titlebar-reload', { bubbles: true, composed: true }));
  };

  /** The open review's name, or the placeholder when none is open. */
  @property() accessor label = '';

  /** The tooltip of the name button, with its shortcut. */
  @property() accessor openTitle = '';

  /** The tooltip of the reload button, with its shortcut. */
  @property() accessor reloadTitle = '';

  /** Whether a review is open, so Reload shows. */
  @property({ type: Boolean }) accessor canReload = false;

  /** Polling found commits the open review doesn't show yet; stays until the reviewer reloads. */
  @property({ type: Boolean }) accessor hasNewCommits = false;

  /** Whether the review is reloading: Reload spins its glyph and waits. */
  @property({ type: Boolean }) accessor reloading = false;

  /** `process.platform`; on macOS the bar leaves room for the window buttons. */
  @property({ reflect: true }) accessor platform = '';

  private renderReload(): TemplateResult {
    let label = 'Reload Review';
    let title = this.reloadTitle;
    if (this.hasNewCommits) {
      label = 'Reload Review: new commits';
      title = `New commits. ${this.reloadTitle}`;
    }
    return html`<button
      type="button"
      class="button icon reload"
      aria-label=${label}
      title=${title}
      aria-busy=${this.reloading ? 'true' : 'false'}
      ?disabled=${this.reloading}
      @click=${this.reload}
    >
      ${displayIcon('refresh')}
      ${this.hasNewCommits ? html`<span class="status-dot" data-tone="accent"></span>` : nothing}
    </button>`;
  }

  protected override render(): TemplateResult {
    return html`<span class="brand">beuve</span>
      <button class="button quiet" type="button" title=${this.openTitle} @click=${this.open}>
        ${this.label}
      </button>
      ${this.canReload ? this.renderReload() : nothing} `;
  }
}
