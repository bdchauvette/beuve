import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type { UraAnchorView, UraSeverityView } from '#contract/ipc-contract.ts';

import './beuve-note-expand.ts';
import './beuve-patch-preview.ts';

import { keyPlatformOf } from './key-platform-of.ts';
import { formatControlStyles } from './format-control-styles.ts';
import { pathText } from './path-text.ts';
import './beuve-ura-label-menu.ts';
import type { UraLabelChange } from './beuve-ura-label-menu.ts';
import { buttonStyles } from './primitives/button-styles.ts';
import { fieldStyles } from './primitives/field-styles.ts';
import { completionListStyles } from './completion-list-styles.ts';
import { EmojiCompletion } from './emoji-completion.ts';
import { emojiCompletionStyles } from './emoji-completion-styles.ts';

/** What the composer submits: a note's label, whether it blocks, one-line title and Markdown body. */
export interface UraDraft {
  readonly severity: UraSeverityView;
  readonly blocking: boolean;
  readonly title: string;
  readonly body: string;
}

/**
 * The compact note composer Add Note opens under the staged lines (ADR 0027): a label menu that
 * also holds the Blocking toggle (`issue`, not blocking, by default; ADR 0131), an optional title
 * and a body. Enter in
 * the title or ⌘/Ctrl+Enter anywhere saves, Escape cancels. Both fields complete `:shortcode:` emoji
 * (ADR 0143), whose open list takes Enter and Escape first.
 * With a suggestion from an Suggest Edit edit (ADR 0043) it previews the patch that is staged with the
 * note. Keys typed here never reach the diff stream's or the shell's shortcuts. Given a staged
 * note's {@link draft}, it opens with that note's text and saves it instead (ADR 0129). Emits
 * `beuve-ura-compose-submit` with a {@link UraDraft} and `beuve-ura-compose-cancel`.
 */
@customElement('beuve-ura-composer')
export class BeuveUraComposer extends LitElement {
  static override styles = [
    buttonStyles,
    fieldStyles,
    formatControlStyles,
    completionListStyles,
    emojiCompletionStyles,
    css`
      :host {
        display: block;
        margin: var(--beuve-space-1) var(--beuve-space-3) var(--beuve-space-2);
        white-space: normal;
        font: var(--beuve-font-body);
        color: var(--beuve-text);
      }

      /* The whole form keeps the note measure, so the fields and actions line up with the body. */
      form {
        box-sizing: border-box;
        max-inline-size: var(--beuve-size-note-measure);
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

      /* The form's header: the directory gives way first, so the file and lines stay readable. */
      .where {
        display: flex;
        min-inline-size: 0;
        white-space: nowrap;
        font: var(--beuve-font-code);
        font-size: var(--beuve-font-size-caption);
        color: var(--beuve-text-muted);
      }

      .where .directory {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .where .file {
        flex: none;
        max-inline-size: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .spacer {
        flex: 1;
      }

      input {
        flex: 1;
      }

      textarea {
        box-sizing: border-box;
        padding: var(--beuve-space-1) var(--beuve-space-2);
        border: var(--beuve-border-width) solid var(--beuve-border);
        border-radius: var(--beuve-radius-small);
        background: var(--beuve-bg);
        color: var(--beuve-text);
        field-sizing: content;
        inline-size: 100%;
        min-block-size: var(--beuve-size-note-editor-min);
        max-block-size: var(--beuve-size-note-editor-max);
        resize: block;
        font: var(--beuve-font-code);
      }

      textarea:focus {
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

  private readonly emoji = new EmojiCompletion(this);

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

  private readonly onLabelChange = (event: CustomEvent<UraLabelChange>): void => {
    this.severity = event.detail.severity;
    this.blocking = event.detail.blocking;
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

  /** `src/dir/file.ts:12-14`, the directory cut short with an ellipsis when it doesn't fit. */
  private renderWhere(): TemplateResult {
    const cut = this.where.lastIndexOf('/') + 1;
    return html`<div class="where" title=${this.where}>
      <span class="directory">${pathText(this.where.slice(0, cut))}</span>
      <span class="file">${pathText(this.where.slice(cut))}</span>
    </div>`;
  }

  /** Focuses the title, for when the composer opens. */
  override focus(): void {
    this.titleInput()?.focus({ preventScroll: true });
  }

  override render(): TemplateResult {
    const labels = submitLabels(this.draft !== undefined);
    return html`<form @submit=${this.onSubmit} aria-label=${labels.form}>
      ${this.renderWhere()}
      <div class="row">
        <beuve-ura-label-menu
          .severity=${this.severity}
          ?blocking=${this.blocking}
          @beuve-ura-label-change=${this.onLabelChange}
        ></beuve-ura-label-menu>
        <input
          class="field"
          aria-label="Title"
          placeholder="Title (optional)"
          maxlength="200"
          autocomplete="off"
          role="combobox"
          aria-expanded="false"
          aria-autocomplete="list"
          aria-controls="emoji-completions"
          data-emoji-completion
        />
      </div>
      <textarea
        aria-label="Body"
        placeholder="Details (Markdown, optional)"
        aria-autocomplete="list"
        aria-controls="emoji-completions"
        data-emoji-completion
      ></textarea>
      ${
        this.patch === ''
          ? nothing
          : html`<div class="suggestion">
              <span class="label">Suggestion</span>
              <beuve-patch-preview .patch=${this.patch}></beuve-patch-preview>
            </div>`
      }
      <div class="row">
        <beuve-note-expand .anchor=${this.anchor}></beuve-note-expand>
        <span class="spacer"></span>
        ${this.error === '' ? nothing : html`<span class="error" role="alert">${this.error}</span>`}
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
      ${this.emoji.render()}
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
