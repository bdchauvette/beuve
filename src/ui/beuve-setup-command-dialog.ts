import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { buttonStyles } from './primitives/button-styles.ts';
import './beuve-dialog.ts';

/** The command the reviewer saved. */
export interface SetupCommandSaveDetail {
  readonly command: string;
}

/**
 * Asks for a repository's setup command (ADR 0130): one line for the reviewer's shell, prefilled
 * with the stored command or a guess from the head's files. Presentational (ADR 0104): emits
 * `beuve-setup-command-save` ({@link SetupCommandSaveDetail}) and `beuve-setup-command-cancel`;
 * the owner stores the command and closes it.
 */
@customElement('beuve-setup-command-dialog')
export class BeuveSetupCommandDialog extends LitElement {
  static override styles = [
    buttonStyles,
    css`
      form {
        display: grid;
        gap: var(--beuve-space-3);
      }

      h2 {
        margin: 0;
        font: var(--beuve-font-heading);
      }

      p {
        margin: 0;
        color: var(--beuve-text-muted);
        font: var(--beuve-font-small);
      }

      input {
        padding: var(--beuve-space-1) var(--beuve-space-2);
        border: var(--beuve-border-width) solid var(--beuve-border);
        border-radius: var(--beuve-radius);
        background: var(--beuve-bg);
        color: var(--beuve-text);
        font: var(--beuve-font-code);
      }

      input:focus {
        border-color: var(--beuve-accent);
        outline: none;
      }

      .error {
        color: var(--beuve-danger);
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--beuve-space-2);
      }
    `,
  ];

  /** `host/owner/repo`, which the command is stored for. */
  @property() accessor repository = '';
  /** The text the input starts with. */
  @property() accessor command = '';
  /** Why the last save was refused, or empty. */
  @property() accessor error = '';
  /** The save also runs the command (Run Setup asked for it). */
  @property({ type: Boolean }) accessor runsAfterSave = false;

  private onSubmit(event: SubmitEvent): void {
    event.preventDefault();
    const input = this.renderRoot.querySelector('input');
    const detail: SetupCommandSaveDetail = { command: input?.value ?? '' };
    this.dispatchEvent(
      new CustomEvent('beuve-setup-command-save', { detail, bubbles: true, composed: true }),
    );
  }

  private cancel(): void {
    this.dispatchEvent(
      new CustomEvent('beuve-setup-command-cancel', { bubbles: true, composed: true }),
    );
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') {
      return;
    }
    event.preventDefault();
    this.cancel();
  }

  protected override firstUpdated(): void {
    this.renderRoot.querySelector('input')?.select();
  }

  override render(): TemplateResult {
    return html`<beuve-dialog
      label="Setup Command"
      @beuve-dialog-dismiss=${(): void => {
        this.cancel();
      }}
    >
      <form
        @submit=${(event: SubmitEvent): void => {
          this.onSubmit(event);
        }}
        @keydown=${(event: KeyboardEvent): void => {
          this.onKeyDown(event);
        }}
      >
        <h2>Setup command for ${this.repository}</h2>
        <p>
          Run Setup types this line into a new terminal in beuve’s checkout of the head, where you
          can watch and stop it. beuve keeps it for this repository, never in the repository, and
          runs it only when you choose Run Setup: installs run the branch’s own scripts.
        </p>
        <input
          aria-label="Setup command"
          spellcheck="false"
          autocomplete="off"
          .value=${this.command}
          placeholder="npm ci &amp;&amp; npm run build"
        />
        ${this.error === '' ? nothing : html`<p class="error" role="alert">${this.error}</p>`}
        <div class="actions">
          <button
            type="button"
            class="button"
            @click=${(): void => {
              this.cancel();
            }}
          >
            Cancel
          </button>
          <button type="submit" class="button primary">
            ${this.runsAfterSave ? 'Save and Run' : 'Save'}
          </button>
        </div>
      </form>
    </beuve-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-setup-command-dialog': BeuveSetupCommandDialog;
  }
}
