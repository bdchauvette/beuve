import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { buttonStyles } from './primitives/button-styles.ts';
import { progressStyles } from './primitives/progress-styles.ts';

/**
 * A review on its way (ADR 0145): what is opening, a progress bar, and the step it is on
 * (`Fetching pull request #12…`, then `Opening review…`). With `cancellable` it offers Cancel, and
 * Escape while it has the focus does the same; both emit `beuve-opening-cancel`. It takes the
 * focus itself (`tabindex="-1"`), so a second Enter from the list it was opened from does nothing.
 */
@customElement('beuve-opening')
export class BeuveOpening extends LitElement {
  static override styles = [
    buttonStyles,
    progressStyles,
    css`
      :host {
        display: grid;
        justify-items: center;
        gap: var(--beuve-space-3);
        outline: none;
        animation: opening-in 160ms ease-out both;
      }

      .label {
        max-inline-size: var(--beuve-size-column);
        font-size: var(--beuve-font-size-large);
        font-weight: var(--beuve-font-weight-semibold);
        text-align: center;
        overflow-wrap: anywhere;
      }

      .stage {
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      @keyframes opening-in {
        from {
          opacity: 0;
          transform: translateY(var(--beuve-space-1)) scale(0.98);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        :host {
          animation: none;
        }
      }
    `,
  ];

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.cancellable || event.key !== 'Escape' || event.defaultPrevented) {
      return;
    }
    event.preventDefault();
    this.onCancelClick();
  };

  private readonly onCancelClick = (): void => {
    this.dispatchEvent(new CustomEvent('beuve-opening-cancel', { bubbles: true, composed: true }));
  };

  /** What is opening: the review's name, or what the reviewer picked. */
  @property() accessor label = '';

  /** The step it is on, such as `Opening review…`. */
  @property() accessor stage = '';

  /** Whether Cancel and Escape stop it. */
  @property({ type: Boolean }) accessor cancellable = false;

  constructor() {
    super();
    this.addEventListener('keydown', this.onKeyDown);
  }

  override connectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.connectedCallback();
    this.tabIndex = -1;
  }

  protected override render(): TemplateResult {
    return html`
      <span class="label">${this.label}</span>
      <span class="progress" aria-hidden="true"></span>
      <span class="stage" role="status" aria-live="polite">${this.stage}</span>
      ${
        this.cancellable
          ? html`<button class="button" type="button" @click=${this.onCancelClick}>Cancel</button>`
          : nothing
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-opening': BeuveOpening;
  }
}
