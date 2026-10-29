import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { displayKey } from './display-key.ts';
import { keybindings } from './keybindings.ts';

/** Modal list of the spec 5A keys, opened with `?`. Closing is handled by `beuve-app`. */
@customElement('beuve-keybinding-overlay')
export class BeuveKeybindingOverlay extends LitElement {
  static override styles = css`
    :host {
      position: fixed;
      inset: 0;
      display: grid;
      place-items: center;
      background: var(--beuve-scrim);
    }

    .panel {
      width: min(460px, calc(100vw - 48px));
      max-height: calc(100vh - 48px);
      overflow: auto;
      box-sizing: border-box;
      padding: var(--beuve-space-4) var(--beuve-space-6);
      border: 1px solid var(--beuve-border);
      border-radius: 10px;
      background: var(--beuve-surface);
      box-shadow: 0 12px 40px #0000004d;
    }

    h1 {
      margin: 0 0 var(--beuve-space-3);
      font-size: 15px;
      font-weight: 600;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    td {
      padding: var(--beuve-space-1) 0;
    }

    td:first-child {
      width: 120px;
    }

    .soon td {
      color: var(--beuve-text-muted);
    }

    .badge {
      font: var(--beuve-font-small);
      color: var(--beuve-text-muted);
      text-align: right;
    }

    kbd {
      display: inline-block;
      min-width: 1.4em;
      margin-right: var(--beuve-space-1);
      padding: 0 var(--beuve-space-1);
      border: 1px solid var(--beuve-border);
      border-bottom-width: 2px;
      border-radius: 4px;
      background: var(--beuve-surface-sunken);
      font: var(--beuve-font-mono);
      font-size: 11px;
      text-align: center;
      color: var(--beuve-text);
    }

    footer {
      margin-top: var(--beuve-space-3);
      font: var(--beuve-font-small);
      color: var(--beuve-text-muted);
    }
  `;

  /** The name of the editor `o` opens, e.g. “Zed”; absent while unknown. */
  @property() accessor editorName = '';
  /** How diffs are shown now, e.g. “Split · whitespace hidden”. */
  @property() accessor displayName = '';
  /** `process.platform`, for writing shortcuts the platform's way. */
  @property() accessor platform = '';

  override render(): TemplateResult {
    return html`
      <div class="panel" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <h1>Keyboard shortcuts</h1>
        <table>
          ${keybindings.map(
            (binding) => html`
              <tr class=${binding.available ? '' : 'soon'}>
                <td>
                  ${binding.keys.map((key) => html`<kbd>${displayKey(key, this.platform)}</kbd>`)}
                </td>
                <td>${binding.action}</td>
                <td class="badge">${binding.scope === 'Anywhere' ? '' : binding.scope}</td>
                <td class="badge">${binding.available ? '' : 'coming soon'}</td>
              </tr>
            `,
          )}
        </table>
        <footer>
          Editor for <kbd>o</kbd>: ${this.editorName === '' ? 'first one found' : this.editorName} ·
          change with <code>/editor zed|vscode|cursor</code> in the chat
        </footer>
        ${
          this.displayName === ''
            ? nothing
            : html`<footer>
                Diffs: ${this.displayName} · <code>/diff split|inline</code>,
                <code>/whitespace ignore|show</code>
              </footer>`
        }
        <footer><kbd>Esc</kbd> or <kbd>?</kbd> closes</footer>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-keybinding-overlay': BeuveKeybindingOverlay;
  }
}
