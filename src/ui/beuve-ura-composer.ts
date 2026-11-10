import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type { UraAnchorView, UraSeverityView } from '#contract/ipc-contract.ts';

import './beuve-note-expand.ts';
import './beuve-patch-preview.ts';

import { keyPlatformOf } from './key-platform-of.ts';
import { formatControlStyles } from './format-control-styles.ts';
import { pathText } from './path-text.ts';
import { displayIcon } from './display-icon.ts';
import { uraSeverityEmoji } from './ura-severity-emoji.ts';
import { uraSeverityViews } from './ura-severity-views.ts';
import { buttonStyles } from './primitives/button-styles.ts';

/** What the composer submits: a note's label, whether it blocks, one-line title and Markdown body. */
export interface UraDraft {
  readonly severity: UraSeverityView;
  readonly blocking: boolean;
  readonly title: string;
  readonly body: string;
}

/**
 * The compact note composer Add Note opens under the staged lines (ADR 0027): a label (`issue` by
 * default), a Blocking toggle (off by default, ADR 0131), an optional title and a body. Enter in
 * the title or ⌘/Ctrl+Enter anywhere saves, Escape cancels.
 * With a suggestion from an Suggest Edit edit (ADR 0043) it previews the patch that is staged with the
 * note. Keys typed here never reach the diff stream's or the shell's shortcuts. Given a staged
 * note's {@link draft}, it opens with that note's text and saves it instead (ADR 0129). Emits
 * `beuve-ura-compose-submit` with a {@link UraDraft} and `beuve-ura-compose-cancel`.
 */
@customElement('beuve-ura-composer')
export class BeuveUraComposer extends LitElement {
  static override styles = [
    buttonStyles,
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
        border: var(--beuve-border-width) solid var(--beuve-border);
        border-inline-start: var(--beuve-border-width-heavy) solid var(--beuve-accent);
        border-radius: var(--beuve-radius);
        background: var(--beuve-surface);
      }

      .row {
        display: flex;
        align-items: center;
        gap: var(--beuve-space-2);
      }

      .where {
        flex: 1;
        min-inline-size: 0;
        overflow-wrap: anywhere;
        font: var(--beuve-font-code);
        font-size: var(--beuve-font-size-caption);
        color: var(--beuve-text-muted);
      }

      input,
      textarea,
      select {
        box-sizing: border-box;
        min-inline-size: 0;
        padding: var(--beuve-space-1) var(--beuve-space-2);
        border: var(--beuve-border-width) solid var(--beuve-border);
        border-radius: var(--beuve-radius-small);
        background: var(--beuve-bg);
        color: var(--beuve-text);
        font: inherit;
      }

      input {
        flex: 1;
      }

      textarea {
        field-sizing: content;
        inline-size: 100%;
        max-inline-size: var(--beuve-size-note-measure);
        min-block-size: var(--beuve-size-editor-small);
        max-block-size: var(--beuve-size-note-editor-max);
        resize: block;
        font: var(--beuve-font-code);
      }

      input:focus,
      textarea:focus,
      select:focus {
        border-color: var(--beuve-accent);
        outline: none;
      }

      .suggestion {
        display: grid;
        gap: var(--beuve-space-0-5);
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

      .row > .button {
        flex: none;
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
  /** The staged note being edited, whose text the fields start from; `undefined` for a new note. */
  @property({ attribute: false }) accessor draft: UraDraft | undefined;
  /** What the note is on, for Expand (ADR 0125). */
  @property({ attribute: false }) accessor anchor: UraAnchorView | undefined;

  @state() accessor severity: UraSeverityView = 'issue';
  @state() accessor blocking = false;

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
    if (this.saving) {
      return;
    }
    const title = this.titleInput()?.value.trim() ?? '';
    const body = this.renderRoot.querySelector('textarea')?.value ?? '';
    if (title === '' && body.trim() === '' && this.patch === '') {
      this.titleInput()?.focus();
      return;
    }
    const draft: UraDraft = { severity: this.severity, blocking: this.blocking, title, body };
    this.dispatchEvent(
      new CustomEvent('beuve-ura-compose-submit', { detail: draft, bubbles: true, composed: true }),
    );
  }

  /** Focuses the title, for when the composer opens. */
  override focus(): void {
    this.titleInput()?.focus({ preventScroll: true });
  }

  override render(): TemplateResult {
    const labels = submitLabels(this.draft !== undefined);
    return html`<form @submit=${this.onSubmit} aria-label=${labels.form}>
      <div class="row">
        <select
          aria-label="Label"
          .value=${this.severity}
          @change=${(event: Event): void => {
            this.severity = (event.target as HTMLSelectElement).value as UraSeverityView;
          }}
        >
          ${uraSeverityViews.map((severity) => {
            return html`<option value=${severity} ?selected=${severity === this.severity}>
              ${uraSeverityEmoji(severity)} ${severity}
            </option>`;
          })}
        </select>
        <button
          class="button quiet"
          type="button"
          name="blocking"
          aria-label="Blocking"
          aria-pressed=${String(this.blocking)}
          title=${this.blocking ? 'Blocking: must be resolved before merging' : 'Not blocking; press to block the merge'}
          @click=${(): void => {
            this.blocking = !this.blocking;
          }}
        >
          ${displayIcon('blocking')}
        </button>
        <input
          aria-label="Title"
          placeholder="Title (optional)"
          maxlength="200"
          autocomplete="off"
        />
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
        <beuve-note-expand .anchor=${this.anchor}></beuve-note-expand>
        <button class="button" type="button" title="Cancel (Esc)" @click=${this.onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          class="button primary"
          title="${labels.idle} (${keyPlatformOf(navigator.platform) === 'mac' ? '⌘↩' : 'Ctrl+Enter'})"
          ?disabled=${this.saving}
        >
          ${this.saving ? labels.saving : labels.idle}
        </button>
      </div>
    </form>`;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has('draft') || this.draft === undefined) {
      return;
    }
    this.severity = this.draft.severity;
    this.blocking = this.draft.blocking;
  }

  protected override firstUpdated(): void {
    this.titleInput()?.focus({ preventScroll: true });
  }

  /** A draft fills the uncontrolled fields once, so typing survives later renders. */
  protected override updated(changed: PropertyValues<this>): void {
    const { draft } = this;
    if (draft === undefined || !changed.has('draft')) {
      return;
    }
    const title = this.titleInput();
    if (title !== undefined) {
      title.value = draft.title;
    }
    const body = this.renderRoot.querySelector('textarea');
    if (body !== null) {
      body.value = draft.body;
    }
  }
}

interface SubmitLabels {
  readonly form: string;
  readonly idle: string;
  readonly saving: string;
}

const stageLabels: SubmitLabels = {
  form: 'Stage a review note',
  idle: 'Stage',
  saving: 'Staging…',
};
const editLabels: SubmitLabels = {
  form: 'Edit a staged review note',
  idle: 'Save',
  saving: 'Saving…',
};

function submitLabels(isEdit: boolean): SubmitLabels {
  if (isEdit) {
    return editLabels;
  }
  return stageLabels;
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-ura-composer': BeuveUraComposer;
  }
}
