import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { AttentionView, CiStatusView } from '#contract/ipc-contract.ts';

import { describeAttention } from './describe-attention.ts';
import { describeCiStatus } from './describe-ci-status.ts';
import { displayIcon } from './display-icon.ts';
import { buttonStyles } from './primitives/button-styles.ts';
import { statusDotStyles } from './primitives/status-dot-styles.ts';

/**
 * The title band over the review's main column (ADR 0157), beside the full-height sidebar: the
 * open review's name, which shows a pull request's Overview tab (or, for another review, the Open
 * dialog), ▾ for the Open dialog, the pull request's CI as a dot (which shows the Overview tab too)
 * and whose turn it is, an icon-only Reload while a review is open (ADR 0146), marked with a dot
 * while polling has found commits the review does not show yet, then, at the end, what the owner
 * slots in: what the diff spans. Narrow, whose turn gives way first, then the slotted content, then the
 * name. The band drags the window; its controls do not. On macOS it leaves room for the window
 * buttons unless `--beuve-titlebar-inset` says the sidebar beside it does. Emits
 * `beuve-titlebar-open`, `beuve-titlebar-overview` and `beuve-titlebar-reload`.
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
        padding-inline-start: var(--beuve-titlebar-inset, var(--beuve-titlebar-traffic-lights));
      }

      button,
      ::slotted(*) {
        -webkit-app-region: no-drag;
      }

      .name {
        display: flex;
        flex: 0 1 auto;
        align-items: center;
        min-inline-size: 0;
      }

      .title {
        min-inline-size: 0;
        overflow: hidden;
        font-weight: var(--beuve-font-weight-semibold);
        text-overflow: ellipsis;
      }

      .open {
        flex: none;
      }

      .ci {
        flex: none;
      }

      .attention {
        flex: 0 10000 auto;
        min-inline-size: 0;
        overflow: hidden;
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
        white-space: nowrap;
        cursor: default;
      }

      .attention.yours {
        color: var(--beuve-accent);
        font-weight: var(--beuve-font-weight-semibold);
      }

      ::slotted(*) {
        flex: 0 100 auto;
        min-inline-size: 0;
        margin-inline-start: auto;
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

  private readonly overview = (): void => {
    this.dispatchEvent(
      new CustomEvent('beuve-titlebar-overview', { bubbles: true, composed: true }),
    );
  };

  private readonly onTitleClick = (): void => {
    if (this.isPullRequest) {
      this.overview();
      return;
    }
    this.open();
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

  /** Whether the open review is a pull request, whose name shows its Overview tab. */
  @property({ type: Boolean }) accessor isPullRequest = false;

  /** CI for the open pull request's head; absent for other reviews. */
  @property({ attribute: false }) accessor ci: CiStatusView | undefined;

  /** Whose turn the open pull request is; absent for other reviews and until it is known. */
  @property({ attribute: false }) accessor attention: AttentionView | undefined;

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

  private renderCi(ci: CiStatusView): TemplateResult {
    const line = describeCiStatus(ci);
    return html`<button
      type="button"
      class="button icon quiet ci"
      aria-label=${line.text}
      title=${`${line.title}\nShow the checks in Overview`}
      @click=${this.overview}
    >
      <span class="status-dot" data-tone=${line.tone}></span>
    </button>`;
  }

  private renderAttention(): TemplateResult | typeof nothing {
    const chip = describeAttention(this.attention);
    if (chip === undefined) {
      return nothing;
    }
    return html`<span class="attention ${chip.isYours ? 'yours' : ''}" title=${chip.title}
      >${chip.text}</span
    >`;
  }

  protected override render(): TemplateResult {
    let titleHint = this.openTitle;
    if (this.isPullRequest) {
      titleHint = 'Show the pull request’s Overview';
    }
    return html`<span class="name">
        <button
          class="button quiet title"
          type="button"
          title=${titleHint}
          @click=${this.onTitleClick}
        >
          ${this.label}
        </button>
        <button
          class="button icon quiet open"
          type="button"
          aria-label="Open another review"
          title=${this.openTitle}
          @click=${this.open}
        >
          ${displayIcon('chevron')}
        </button>
      </span>
      ${this.ci === undefined ? nothing : this.renderCi(this.ci)} ${this.renderAttention()}
      ${this.canReload ? this.renderReload() : nothing}
      <slot></slot>`;
  }
}
