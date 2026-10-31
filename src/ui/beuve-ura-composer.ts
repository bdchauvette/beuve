import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type { UraSeverityView } from '#contract/ipc-contract.ts';

import './beuve-patch-preview.ts';

import { keyPlatformOf } from './key-platform-of.ts';
import { formatControlStyles } from './format-control-styles.ts';
import { pathText } from './path-text.ts';

/** What the composer submits: a new note's severity, one-line title and Markdown body. */
export interface UraDraft {
  readonly severity: UraSeverityView;
  readonly title: string;
  readonly body: string;
}

const severities: readonly UraSeverityView[] = ['blocker', 'issue', 'question', 'nit', 'praise'];

/**
 * The compact note composer Add Note opens under the staged lines (ADR 0027): severity (`issue` by
 * default), title and body. Enter in the title or ⌘/Ctrl+Enter anywhere saves, Escape cancels.
 * With a suggestion from an Suggest Edit edit (ADR 0043) it previews the patch that is staged with the
 * note. Keys typed here never reach the diff stream's or the shell's shortcuts. Emits
 * `beuve-ura-compose-submit` with a {@link UraDraft} and `beuve-ura-compose-cancel`.
 */
@customElement('beuve-ura-composer')
export class BeuveUraComposer extends LitElement {
  static override styles = [
    formatControlStyles,
    css`
      :host {
        display: block;
        margin: var(--beuve-space-1) var(--beuve-space-3) var(--beuve-space-2);
        white-space: normal;
        font: var(--beuve-font-body);
        color: var(--beuve-text);
      }

      form {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--beuve-space-1);
        padding: var(--beuve-space-2);
        border: 1px solid var(--beuve-border);
        border-left: 3px solid var(--beuve-accent);
        border-radius: var(--beuve-radius);
        background: var(--beuve-surface);
      }

      .row {
        display: flex;
        align-items: center;
        gap: var(--beuve-space-2);
      }

      .where {
        font: var(--beuve-font-mono);
        font-size: 11px;
        color: var(--beuve-text-muted);
      }

      .spacer {
        flex: 1;
      }

      input,
      textarea,
      select {
        box-sizing: border-box;
        min-width: 0;
        padding: var(--beuve-space-1) var(--beuve-space-2);
        border: 1px solid var(--beuve-border);
        border-radius: 4px;
        background: var(--beuve-bg);
        color: var(--beuve-text);
        font: inherit;
      }

      input {
        flex: 1;
      }

      textarea {
        width: 100%;
        min-height: 48px;
        resize: vertical;
        font: var(--beuve-font-mono);
      }

      input:focus,
      textarea:focus,
      select:focus {
        border-color: var(--beuve-accent);
        outline: none;
      }

      button {
        padding: 0 var(--beuve-space-2);
        border: 1px solid var(--beuve-border);
        border-radius: 4px;
        background: var(--beuve-surface);
        color: var(--beuve-text);
        font: var(--beuve-font-small);
        cursor: pointer;
      }

      button.primary {
        border-color: var(--beuve-accent);
        background: var(--beuve-accent);
        color: #fff;
      }

      .suggestion {
        display: grid;
        gap: 2px;
      }

      .suggestion .label {
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      .hint,
      .error {
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      .error {
        color: var(--beuve-danger);
      }
    `,
  ];

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // Text entry is never a shortcut: nothing typed here reaches the stream or the shell.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      this.dispatchEvent(
        new CustomEvent('beuve-ura-compose-cancel', { bubbles: true, composed: true }),
      );
      return;
    }
    if (event.key !== 'Enter') {
      return;
    }
    const isTitle = event.composedPath()[0] === this.titleInput();
    if (!isTitle && !event.metaKey && !event.ctrlKey) {
      return;
    }
    event.preventDefault();
    this.submit();
  };

  private readonly onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    this.submit();
  };

  private readonly onCancel = (): void => {
    this.dispatchEvent(
      new CustomEvent('beuve-ura-compose-cancel', { bubbles: true, composed: true }),
    );
  };

  /** `src/a.ts:12-14`, shown so the reviewer sees what the note is about. */
  @property() accessor where = '';
  /** Set by the owner while the note is being saved, or when saving failed. */
  @property({ type: Boolean }) accessor saving = false;
  @property() accessor error = '';
  /** The suggested patch staged with the note; empty for none. */
  @property() accessor patch = '';

  @state() accessor severity: UraSeverityView = 'issue';

  constructor() {
    super();
    this.addEventListener('keydown', this.onKeyDown);
    // Clicks inside the composer must not make the card or stream steal focus.
    this.addEventListener('click', (event) => {
      event.stopPropagation();
    });
  }

  private titleInput(): HTMLInputElement | undefined {
    return this.renderRoot.querySelector('input') ?? undefined;
  }

  private submit(): void {
    const title = this.titleInput()?.value.trim() ?? '';
    if (title === '' || this.saving) {
      this.titleInput()?.focus();
      return;
    }
    const draft: UraDraft = {
      severity: this.severity,
      title,
      body: this.renderRoot.querySelector('textarea')?.value ?? '',
    };
    this.dispatchEvent(
      new CustomEvent('beuve-ura-compose-submit', { detail: draft, bubbles: true, composed: true }),
    );
  }

  /** Focuses the title, for when the composer opens. */
  override focus(): void {
    this.titleInput()?.focus({ preventScroll: true });
  }

  override render(): TemplateResult {
    return html`<form @submit=${this.onSubmit} aria-label="Stage a review note">
      <div class="row">
        <select
          aria-label="Severity"
          .value=${this.severity}
          @change=${(event: Event): void => {
            this.severity = (event.target as HTMLSelectElement).value as UraSeverityView;
          }}
        >
          ${severities.map((severity) => {
            return html`<option value=${severity} ?selected=${severity === this.severity}>
              ${severity}
            </option>`;
          })}
        </select>
        <input aria-label="Title" placeholder="Title" maxlength="200" autocomplete="off" />
      </div>
      <textarea aria-label="Body" placeholder="Details (Markdown, optional)"></textarea>
      ${
        this.patch === ''
          ? nothing
          : html`<div class="suggestion">
              <span class="label">Suggestion</span>
              <beuve-patch-preview .patch=${this.patch}></beuve-patch-preview>
            </div>`
      }
      <div class="row">
        <span class="where">${pathText(this.where)}</span>
        ${this.error === '' ? nothing : html`<span class="error" role="alert">${this.error}</span>`}
        <span class="spacer"></span>
        <button type="button" title="Cancel (Esc)" @click=${this.onCancel}>Cancel</button>
        <button
          type="submit"
          class="primary"
          title="Stage (${keyPlatformOf(navigator.platform) === 'mac' ? '⌘↩' : 'Ctrl+Enter'})"
          ?disabled=${this.saving}
        >
          ${this.saving ? 'Staging…' : 'Stage'}
        </button>
      </div>
    </form>`;
  }

  protected override firstUpdated(): void {
    this.titleInput()?.focus({ preventScroll: true });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-ura-composer': BeuveUraComposer;
  }
}
