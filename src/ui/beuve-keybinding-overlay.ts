import { css, html, LitElement } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { commandCatalog } from '#contract/command-catalog.ts';

import { keyPlatformOf } from './key-platform-of.ts';
import { shortcutSectionsFor } from './shortcut-sections-for.ts';
import { buttonStyles } from './primitives/button-styles.ts';

/**
 * Help ▸ Keyboard Shortcuts (ADR 0068): every key of the catalog, grouped by menu and then by
 * the place it works in. Esc or × emits `beuve-shortcuts-close`.
 */
@customElement('beuve-keybinding-overlay')
export class BeuveKeybindingOverlay extends LitElement {
  static override styles = [
    buttonStyles,
    css`
      :host {
        position: fixed;
        inset: 0;
        z-index: 20;
        display: grid;
        place-items: center;
        background: var(--beuve-scrim);
      }

      .panel {
        inline-size: min(520px, calc(100vw - 48px));
        max-block-size: calc(100vh - 48px);
        overflow: auto;
        box-sizing: border-box;
        padding: var(--beuve-space-4) var(--beuve-space-6);
        border: 1px solid var(--beuve-border);
        border-radius: 10px;
        background: var(--beuve-surface);
        box-shadow: var(--beuve-shadow-large);
      }

      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-block-end: var(--beuve-space-2);
      }

      h1 {
        margin: 0;
        font-size: var(--beuve-font-size-large);
        font-weight: var(--beuve-font-weight-semibold);
      }

      h2 {
        margin: var(--beuve-space-3) 0 var(--beuve-space-1);
        font: var(--beuve-font-small);
        font-weight: var(--beuve-font-weight-semibold);
        color: var(--beuve-text-muted);
      }

      .panel:focus {
        outline: none;
      }

      table {
        inline-size: 100%;
        border-collapse: collapse;
      }

      td {
        padding: var(--beuve-space-1) 0;
      }

      td.keys {
        text-align: end;
        white-space: nowrap;
      }

      kbd {
        display: inline-block;
        min-inline-size: 1.4em;
        margin-inline-end: var(--beuve-space-1);
        padding: 0 var(--beuve-space-1);
        border: 1px solid var(--beuve-border);
        border-block-end-width: 2px;
        border-radius: var(--beuve-radius-small);
        background: var(--beuve-surface-sunken);
        font: var(--beuve-font-mono);
        font-size: var(--beuve-font-size-caption);
        text-align: center;
        color: var(--beuve-text);
      }
    `,
  ];

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.close();
  };

  private readonly close = (): void => {
    this.dispatchEvent(new CustomEvent('beuve-shortcuts-close', { bubbles: true, composed: true }));
  };

  /** `process.platform`, for writing shortcuts the platform's way. */
  @property() accessor platform = '';

  override connectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.connectedCallback();
    this.addEventListener('keydown', this.onKeyDown);
  }

  override disconnectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.disconnectedCallback();
    this.removeEventListener('keydown', this.onKeyDown);
  }

  override render(): TemplateResult {
    const sections = shortcutSectionsFor(commandCatalog, keyPlatformOf(this.platform));
    return html`
      <div
        class="panel"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard Shortcuts"
        tabindex="-1"
      >
        <header>
          <h1>Keyboard Shortcuts</h1>
          <button
            type="button"
            class="button icon close"
            title="Close (Esc)"
            aria-label="Close"
            @click=${this.close}
          >
            ×
          </button>
        </header>
        ${sections.map((section) => {
          return html`
            <h2>${section.title}</h2>
            <table>
              ${section.rows.map((row) => {
                return html`
                  <tr>
                    <td>${row.title}</td>
                    <td class="keys">
                      ${row.keys.map((key) => {
                        return html`<kbd>${key}</kbd>`;
                      })}
                    </td>
                  </tr>
                `;
              })}
            </table>
          `;
        })}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-keybinding-overlay': BeuveKeybindingOverlay;
  }
}
