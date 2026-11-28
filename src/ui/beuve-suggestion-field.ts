import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type { UraAnchorView, UraSuggestionDraftView } from '#contract/ipc-contract.ts';

import type * as SuggestionEditorModule from './create-suggestion-editor.ts';
import type { SuggestionEditor } from './create-suggestion-editor.ts';
import { describeSuggestionLines } from './describe-suggestion-lines.ts';
import { formatControlStyles } from './format-control-styles.ts';
import { isOnNoteLines } from './is-on-note-lines.ts';
import { loadTokenMarks } from './load-token-marks.ts';
import { pathText } from './path-text.ts';
import { buttonStyles } from './primitives/button-styles.ts';
import type { SuggestionFieldView } from './suggestion-field-view.ts';

/**
 * `beuve-suggestion-lines`: a field asks for the text its lines have at a head, to start from it.
 * A container answers with `respond`; `undefined` when the lines can't be read.
 */
export interface SuggestionLinesRequestDetail {
  readonly headSha: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly respond: (text: Promise<string | undefined>) => void;
}

/** `beuve-suggestion-field-remove`: the field's Remove, naming its key. */
export interface SuggestionFieldKeyDetail {
  readonly key: string;
}

/** Where the field is: reading its lines, loading its editor, editing, or unable to read them. */
type Phase = 'reading' | 'opening' | 'ready';

/**
 * One suggestion of a note (ADR 0162): a header naming its `path:Lstart–end`, unless those are
 * the note's own {@link anchor} lines (with why it is outdated, if it is) and Remove, over a CodeMirror field (`createSuggestionEditor`, a lazy chunk)
 * highlighted by beuve's own highlighter (`loadTokenMarks`). A field without a `replacement`
 * starts from the current text of its lines, which it asks its container for
 * (`beuve-suggestion-lines`). The text is the field's own until {@link draft} reads it; a field
 * moved out of the document and back keeps it. Its editor is contenteditable, so it reports
 * `text-focus` as every text field does. Presentational: emits `beuve-suggestion-field-remove`,
 * `beuve-suggestion-field-save` (⌘/Ctrl+Return), `beuve-suggestion-field-cancel` (Escape) and
 * `beuve-suggestion-field-edit` (its text changed after it opened, which ends an autoedit's undo).
 */
@customElement('beuve-suggestion-field')
export class BeuveSuggestionField extends LitElement {
  static override styles = [
    buttonStyles,
    formatControlStyles,
    css`
      :host {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--beuve-space-0-5);
      }

      .head {
        display: flex;
        align-items: center;
        gap: var(--beuve-space-2);
        min-inline-size: 0;
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      .where {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font: var(--beuve-font-code);
        font-size: var(--beuve-font-size-caption);
      }

      .outdated,
      .notice {
        flex: none;
      }

      .notice {
        color: var(--beuve-danger);
      }

      .spacer {
        flex: 1;
      }

      .head > .button {
        flex: none;
      }

      .status {
        padding: var(--beuve-space-1) var(--beuve-space-2);
        border: var(--beuve-border-width) solid var(--beuve-border);
        border-radius: var(--beuve-radius-small);
        background: var(--beuve-code-bg);
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }
    `,
  ];

  private editor: SuggestionEditor | undefined;
  /** The field's text while it has no editor: where it starts, or what it held when moved out. */
  private text: string | undefined;
  private isOpening = false;
  private isFocusWanted = false;
  /** The latest text to highlight, while a frame to highlight it is pending. */
  private pendingHighlight: string | undefined;

  private readonly onRemove = (): void => {
    this.emit('beuve-suggestion-field-remove');
  };

  /** The suggestion this field shows; its `key` must not change while the field lives. */
  @property({ attribute: false }) accessor field: SuggestionFieldView | undefined;
  /** The note's anchor: a field on exactly its lines doesn't name them again. */
  @property({ attribute: false }) accessor anchor: UraAnchorView | undefined;

  @state() accessor phase: Phase = 'opening';
  /** Why the field started empty, when its lines couldn't be read. */
  @state() accessor notice = '';

  /** Reads the field's starting text if it has none, then builds its editor. */
  private async open(): Promise<void> {
    const { field } = this;
    if (field === undefined || this.editor !== undefined || this.isOpening || !this.isConnected) {
      return;
    }
    this.isOpening = true;
    try {
      this.text ??= await this.startingText(field);
      this.phase = 'opening';
      const module = await loadEditorModule();
      const parent = this.renderRoot.querySelector<HTMLElement>('.editor');
      if (parent === null || !this.isStillConnected() || !(this.renderRoot instanceof ShadowRoot)) {
        return;
      }
      this.editor = module.createSuggestionEditor({
        parent,
        root: this.renderRoot,
        text: this.text,
        label: describeSuggestionLines(field).name,
        onSave: (): void => {
          this.emit('beuve-suggestion-field-save');
        },
        onCancel: (): void => {
          this.emit('beuve-suggestion-field-cancel');
        },
        onChange: (text): void => {
          if (this.editor !== undefined) {
            this.emit('beuve-suggestion-field-edit');
          }
          this.scheduleHighlight(text);
        },
      });
      this.phase = 'ready';
      if (this.isFocusWanted) {
        this.isFocusWanted = false;
        this.editor.focus();
      }
    } finally {
      this.isOpening = false;
    }
  }

  /** Whether the field is in the document, read again after an `await`. */
  private isStillConnected(): boolean {
    return this.isConnected;
  }

  /** The field's replacement, nothing for an insertion, or its lines' text from the container. */
  private async startingText(field: SuggestionFieldView): Promise<string> {
    if (field.replacement !== undefined) {
      return field.replacement;
    }
    const { headSha, path, startLine, endLine } = field;
    if (endLine === startLine - 1) {
      return '';
    }
    this.phase = 'reading';
    let answer: Promise<string | undefined> | undefined;
    const detail: SuggestionLinesRequestDetail = {
      headSha,
      path,
      startLine,
      endLine,
      respond: (text): void => {
        answer = text;
      },
    };
    this.dispatchEvent(
      new CustomEvent('beuve-suggestion-lines', { detail, bubbles: true, composed: true }),
    );
    const text = await answer;
    if (text === undefined) {
      this.notice = 'beuve could not read these lines, so the field starts empty.';
      return '';
    }
    return text;
  }

  /** Highlights the latest text once a frame, so typing never waits for the highlighter. */
  private scheduleHighlight(text: string): void {
    const isScheduled = this.pendingHighlight !== undefined;
    this.pendingHighlight = text;
    if (isScheduled) {
      return;
    }
    requestAnimationFrame(() => {
      const latest = this.pendingHighlight;
      this.pendingHighlight = undefined;
      const path = this.field?.path;
      if (latest === undefined || path === undefined) {
        return;
      }
      void loadTokenMarks({ path, text: latest }).then((marks) => {
        this.editor?.mark(marks, latest);
      });
    });
  }

  private emit(name: string): void {
    const key = this.field?.key;
    if (key === undefined) {
      return;
    }
    const detail: SuggestionFieldKeyDetail = { key };
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  /** The suggestion as the note will carry it; `undefined` while its lines are still being read. */
  draft(): UraSuggestionDraftView | undefined {
    const { field } = this;
    const text = this.editor?.text() ?? this.text;
    if (field === undefined || text === undefined) {
      return undefined;
    }
    const { id, path, startLine, endLine } = field;
    return { ...(id !== undefined && { id }), path, startLine, endLine, replacement: text };
  }

  /** Focuses the editor, once it exists. */
  override focus(): void {
    if (this.editor === undefined) {
      this.isFocusWanted = true;
      return;
    }
    this.editor.focus();
  }

  override connectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.connectedCallback();
    if (this.hasUpdated) {
      this.requestUpdate();
    }
  }

  /** CodeMirror is torn down outside the document; its text stays for when the field is back. */
  override disconnectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.disconnectedCallback();
    if (this.editor === undefined) {
      return;
    }
    this.text = this.editor.text();
    this.editor.destroy();
    this.editor = undefined;
    this.phase = 'opening';
  }

  override render(): TemplateResult {
    const { field } = this;
    if (field === undefined) {
      return html``;
    }
    const labels = describeSuggestionLines(field);
    return html`<div class="head">
        ${
          isOnNoteLines(field, this.anchor)
            ? nothing
            : html`<span class="where" title=${labels.heading}>${pathText(labels.heading)}</span>`
        }
        ${field.outdated === undefined ? nothing : html`<span class="outdated">${field.outdated}</span>`}
        ${this.notice === '' ? nothing : html`<span class="notice" role="alert">${this.notice}</span>`}
        <span class="spacer"></span>
        <button
          class="button small quiet"
          type="button"
          aria-label=${`Remove ${labels.name}`}
          @click=${this.onRemove}
        >
          Remove
        </button>
      </div>
      ${
        this.phase === 'ready'
          ? nothing
          : html`<div class="status">
              ${this.phase === 'reading' ? 'Reading the lines…' : 'Opening…'}
            </div>`
      }
      <div class="editor"></div>`;
  }

  protected override updated(): void {
    void this.open();
  }
}

const shared: { module: Promise<typeof SuggestionEditorModule> | undefined } = {
  module: undefined,
};

/** CodeMirror and the field's setup, a lazy chunk loaded by the first suggestion field. */
async function loadEditorModule(): Promise<typeof SuggestionEditorModule> {
  shared.module ??= import('./create-suggestion-editor.ts');
  return shared.module;
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-suggestion-field': BeuveSuggestionField;
  }
}
