import { css, html, LitElement } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * A modal frame over a scrim: what is slotted in sits in a dialog near the top of the window.
 * Clicking the scrim, and only the scrim, emits `beuve-dialog-dismiss`. A presentational layout
 * (ADR 0104); the owner decides whether the dialog shows and what closes it.
 */
@customElement('beuve-dialog')
export class BeuveDialog extends LitElement {
  static override styles = css`
    :host {
      position: fixed;
      inset: 0;
      z-index: 20;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding-block-start: var(--beuve-size-window-offset);
      background: var(--beuve-scrim-soft);
    }

    .dialog {
      inline-size: min(
        var(--beuve-size-dialog),
        calc(var(--beuve-size-window-inline) - 2 * var(--beuve-space-6))
      );
      box-sizing: border-box;
      padding: var(--beuve-space-4);
      border: var(--beuve-border-width) solid var(--beuve-border);
      border-radius: var(--beuve-radius-large);
      background: var(--beuve-surface);
      box-shadow: var(--beuve-shadow-large);
    }

    :host([wide]) .dialog {
      inline-size: min(
        var(--beuve-size-dialog-wide),
        calc(var(--beuve-size-window-inline) - 2 * var(--beuve-space-6))
      );
    }
  `;

  private readonly onClick = (event: MouseEvent): void => {
    if (event.composedPath()[0] === this) {
      this.dispatchEvent(
        new CustomEvent('beuve-dialog-dismiss', { bubbles: true, composed: true }),
      );
    }
  };

  /** The dialog's accessible name. */
  @property() accessor label = '';

  /** A wide dialog, for a list with columns (the review queue). */
  @property({ type: Boolean, reflect: true }) accessor wide = false;

  override connectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.connectedCallback();
    this.addEventListener('click', this.onClick);
  }

  override disconnectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.disconnectedCallback();
    this.removeEventListener('click', this.onClick);
  }

  protected override render(): TemplateResult {
    return html`<div class="dialog" role="dialog" aria-modal="true" aria-label=${this.label}>
      <slot></slot>
    </div>`;
  }
}
