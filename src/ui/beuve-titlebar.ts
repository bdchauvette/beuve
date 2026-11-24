import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { displayIcon } from './display-icon.ts';
import type { SessionHeading } from './session-heading-from.ts';
import { buttonStyles } from './primitives/button-styles.ts';
import { statusDotStyles } from './primitives/status-dot-styles.ts';

/**
 * The title band over the review's main column (ADR 0157), beside the full-height sidebar, for
 * what the reviewer needs all the time: the open review's name (a pull request's shows its
 * Overview tab; another review's is plain text: File › Open opens another), an icon-only Reload
 * while a review is open (ADR 0146), marked with a dot while polling has found commits the review
 * does not show yet, then, at the end, what the owner slots in (how big the diff is, how it is
 * shown), each section parted from the one before by a full-height line. Only the name gives way
 * when the band is narrow; ambient facts are in the status bar. The band drags the window; its
 * controls do not. On macOS it leaves room for the window buttons unless
 * `--beuve-titlebar-inset` says the sidebar beside it does. Emits `beuve-titlebar-overview` and
 * `beuve-titlebar-reload`.
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

      /*
       * The name is the one thing in the band that gives way (ADR 0157 amendment): its parts sit in
       * spans because the button lays out as a flex box, where bare text cannot ellipsize. Where it
       * is and the number stay whole and muted; what it is ellipsizes.
       */
      .title {
        display: flex;
        align-items: center;
        min-inline-size: 0;
        overflow: hidden;
        gap: var(--beuve-space-1-5);
        white-space: nowrap;
      }

      span.title {
        padding-inline: var(--beuve-space-2);
      }

      .context {
        flex: none;
        color: var(--beuve-text-muted);
      }

      .number {
        flex: none;
        font: var(--beuve-font-code);
        color: var(--beuve-text-muted);
      }

      .label {
        min-inline-size: 0;
        overflow: hidden;
        color: var(--beuve-text);
        font-weight: var(--beuve-font-weight-semibold);
        text-overflow: ellipsis;
      }

      .label.branch {
        font: var(--beuve-font-code);
        font-weight: var(--beuve-font-weight-semibold);
      }

      .spacer {
        flex: 1;
      }

      /* Each slotted section is parted from what comes before it by a full-height line. */
      ::slotted(*) {
        display: flex;
        flex: none;
        align-self: stretch;
        align-items: center;
        padding-inline-start: var(--beuve-space-3);
        border-inline-start: var(--beuve-border-width) solid var(--beuve-border);
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

  private readonly overview = (): void => {
    this.dispatchEvent(
      new CustomEvent('beuve-titlebar-overview', { bubbles: true, composed: true }),
    );
  };

  private readonly reload = (): void => {
    this.dispatchEvent(new CustomEvent('beuve-titlebar-reload', { bubbles: true, composed: true }));
  };

  /** The open review's name in its parts; `undefined` with none open. */
  @property({ attribute: false }) accessor heading: SessionHeading | undefined;

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

  private renderHeading(heading: SessionHeading): TemplateResult {
    return html`<span class="context">${heading.context}</span>${
        heading.number === undefined ? nothing : html`<span class="number">${heading.number}</span>`
      }${
        heading.name === ''
          ? nothing
          : html`<span class="label ${heading.isBranch ? 'branch' : ''}">${heading.name}</span>`
      }`;
  }

  /** A pull request's name shows its Overview tab; another review's is plain text. */
  private renderName(heading: SessionHeading): TemplateResult {
    if (!this.isPullRequest) {
      return html`<span class="title">${this.renderHeading(heading)}</span>`;
    }
    return html`<button
      class="button quiet title"
      type="button"
      title="Show the pull request’s Overview"
      @click=${this.overview}
    >
      ${this.renderHeading(heading)}
    </button>`;
  }

  protected override render(): TemplateResult {
    return html`<span class="name"
        >${this.heading === undefined ? nothing : this.renderName(this.heading)}</span
      >
      ${this.canReload ? this.renderReload() : nothing}
      <span class="spacer"></span><slot></slot>`;
  }
}
