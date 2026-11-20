import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { displayIcon } from './display-icon.ts';
import { buttonStyles } from './primitives/button-styles.ts';

/**
 * The window's top bar: the name of the open review, which opens the Open dialog, an icon-only
 * Reload beside it while a review is open (ADR 0146), and New Commits after it while polling has
 * found commits the review does not show yet. The bar drags the window; its buttons do not. Emits
 * `beuve-titlebar-open`, `beuve-titlebar-reload` and `beuve-titlebar-new-commits`.
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

      .reload,
      .new-commits {
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
    `,
  ];

  private readonly open = (): void => {
    this.dispatchEvent(new CustomEvent('beuve-titlebar-open', { bubbles: true, composed: true }));
  };

  private readonly reload = (): void => {
    this.dispatchEvent(new CustomEvent('beuve-titlebar-reload', { bubbles: true, composed: true }));
  };

  private readonly showNewCommits = (): void => {
    this.dispatchEvent(
      new CustomEvent('beuve-titlebar-new-commits', { bubbles: true, composed: true }),
    );
  };

  /** The open review's name, or the placeholder when none is open. */
  @property() accessor label = '';

  /** The tooltip of the name button, with its shortcut. */
  @property() accessor openTitle = '';

  /** The tooltip of the reload button, with its shortcut. */
  @property() accessor reloadTitle = '';

  /** Whether a review is open, so Reload shows. */
  @property({ type: Boolean }) accessor canReload = false;

  /** Polling found commits the open review doesn't show yet; stays until the reviewer shows them. */
  @property({ type: Boolean }) accessor hasNewCommits = false;

  /** Whether the review is reloading: Reload spins its glyph and waits. */
  @property({ type: Boolean }) accessor reloading = false;

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

  private renderNewCommits(): TemplateResult {
    return html`<button
      type="button"
      class="button small primary new-commits"
      title="Reload the review with the new commits"
      ?disabled=${this.reloading}
      @click=${this.showNewCommits}
    >
      New commits
    </button>`;
  }

  protected override render(): TemplateResult {
    return html`<span class="brand">beuve</span>
      <button class="button quiet" type="button" title=${this.openTitle} @click=${this.open}>
        ${this.label}
      </button>
      ${this.canReload ? this.renderReload() : nothing}
      ${this.canReload && this.hasNewCommits ? this.renderNewCommits() : nothing}`;
  }
}
