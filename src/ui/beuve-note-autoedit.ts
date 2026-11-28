import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type {
  AutoeditSuggestionDraftView,
  AutoeditSuggestionView,
  UraAnchorView,
  UraSeverityView,
} from '#contract/ipc-contract.ts';

import { autoeditedFormFrom } from './autoedited-form-from.ts';
import type { AutoeditForm } from './autoedited-form-from.ts';
import type { BeuveSuggestionField } from './beuve-suggestion-field.ts';
import type { BeuveUraLabelMenu } from './beuve-ura-label-menu.ts';
import { countNoun } from './count-noun.ts';
import { buttonStyles } from './primitives/button-styles.ts';
import type { SuggestionFieldView } from './suggestion-field-view.ts';

/** What ✨ Autoedit sends (ADR 0125): the note's fields as the form holds them now. */
export interface NoteAutoeditDraft {
  readonly anchor: UraAnchorView;
  /** The head the anchor refers to; the open review's head when absent. */
  readonly headSha?: string;
  /** Names the note, so a newer autoedit of it replaces one in flight. */
  readonly noteKey: string;
  readonly severity: UraSeverityView;
  readonly blocking: boolean;
  readonly title: string;
  readonly body: string;
  /** The suggestion fields, each with its key and the text it holds now. */
  readonly suggestions: readonly AutoeditSuggestionDraftView[];
}

/** How an autoedit ended. `cancelled` shows nothing. */
export type NoteAutoeditOutcome =
  | {
      readonly kind: 'autoedited';
      readonly body: string;
      readonly suggestions: readonly AutoeditSuggestionView[];
      /** How many suggestions the answer proposed that main left out as invalid. */
      readonly dropped: number;
      /** The head the request was made at, which new fields' lines are on. */
      readonly headSha: string;
    }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'cancelled' };

/**
 * `beuve-note-autoedit-request`: the draft, a signal that aborts when the reviewer cancels, and
 * `respond`, which whoever can reach main (the review) calls once, at once, with the answer.
 */
export interface NoteAutoeditRequestDetail {
  readonly draft: NoteAutoeditDraft;
  readonly signal: AbortSignal;
  readonly respond: (outcome: Promise<NoteAutoeditOutcome>) => void;
}

/**
 * `beuve-suggestion-fields-replace`: the form's suggestion fields as an autoedit, or its undo,
 * leaves them. The form's owner, which keeps the list, replaces its list with `fields`.
 */
export interface SuggestionFieldsReplaceDetail {
  readonly fields: readonly SuggestionFieldView[];
}

/** The form as it was before an autoedit, and the field keys the autoedit left. */
interface UndoState {
  readonly before: AutoeditForm;
  readonly keys: readonly string[];
  readonly dropped: number;
}

/**
 * The ✨ Autoedit button of a note form (ADR 0125 and its amendment "Autoedit: body and
 * suggestions"), at the start of the form's last row, away from its Cancel and Stage or Save at
 * the end, placed inside the `<form>` whose Title input, Body textarea (found by their
 * `aria-label`), `beuve-ura-label-menu` and `beuve-suggestion-field`s it reads. Enabled while the
 * title or body has text. It asks with a composed `beuve-note-autoedit-request`
 * ({@link NoteAutoeditRequestDetail}) and never calls the bridge; while it waits it shows
 * Autoediting… and a Stop, never a second Cancel beside the form's. The answer only fills the
 * form: it replaces the body's text and asks the form's owner to revise and add suggestion
 * fields (`beuve-suggestion-fields-replace`); nothing is staged or saved. Undo autoedit then
 * restores the body and every field as they were, until the reviewer edits the form (types in
 * it, or a field is added or removed) or it closes; a card moving its form in the document
 * keeps it. A failure shows beside the button.
 */
@customElement('beuve-note-autoedit')
export class BeuveNoteAutoedit extends LitElement {
  static override styles = [
    buttonStyles,
    css`
      :host {
        display: inline-flex;
        align-items: center;
        gap: var(--beuve-space-2);
        min-inline-size: 0;
      }

      .button,
      .status {
        flex: none;
        white-space: nowrap;
      }

      .status,
      .error {
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      .error {
        overflow-wrap: anywhere;
        color: var(--beuve-danger);
      }
    `,
  ];

  private form: HTMLFormElement | undefined;
  private controller: AbortController | undefined;
  /** Set while the answer is put in the form, so its own input events don't count as edits. */
  private isApplying = false;
  /** Watches the form's fields come and go, to drop the undo once the reviewer changes them. */
  private readonly fieldsObserver = new MutationObserver(() => {
    this.onFieldsMutated();
  });

  private readonly onHasText = (): void => {
    this.hasText = this.fieldText('title').trim() !== '' || this.fieldText('body').trim() !== '';
  };

  private readonly onFormInput = (): void => {
    this.onHasText();
    if (!this.isApplying) {
      this.dropUndo();
    }
  };

  private readonly onFieldEdit = (): void => {
    if (!this.isApplying) {
      this.dropUndo();
    }
  };

  private readonly onAutoedit = (): void => {
    void this.autoedit();
  };

  private readonly onStop = (): void => {
    this.controller?.abort();
  };

  private readonly onUndo = (): void => {
    this.undo();
  };

  /** The note's anchor; without one the button stays disabled. */
  @property({ attribute: false }) accessor anchor: UraAnchorView | undefined;
  /** The head `anchor` refers to; empty for the open review's head. */
  @property() accessor headSha = '';
  @property() accessor noteKey = 'new';

  @state() accessor hasText = false;
  @state() accessor error = '';
  @state() accessor isAutoediting = false;
  /** What Undo autoedit restores, while it is offered. */
  @state() accessor undoState: UndoState | undefined;

  private field(name: 'title' | 'body'): HTMLElement | undefined {
    const selectors = {
      title: 'input[aria-label="Title"]',
      body: 'textarea[aria-label="Body"]',
    } as const;
    return this.form?.querySelector<HTMLElement>(selectors[name]) ?? undefined;
  }

  private labelMenu(): BeuveUraLabelMenu | undefined {
    return this.form?.querySelector('beuve-ura-label-menu') ?? undefined;
  }

  private suggestionFields(): BeuveSuggestionField[] {
    return [...(this.form?.querySelectorAll('beuve-suggestion-field') ?? [])];
  }

  private fieldText(name: 'title' | 'body'): string {
    const element = this.field(name);
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return element.value;
    }
    return '';
  }

  private isBlocking(): boolean {
    return this.labelMenu()?.blocking ?? false;
  }

  private severity(): UraSeverityView {
    return this.labelMenu()?.severity ?? 'issue';
  }

  /**
   * The form's body and fields as they hold now, each field with its current text; `undefined`
   * while a field is still reading its lines.
   */
  private currentForm(): AutoeditForm | undefined {
    const fields: SuggestionFieldView[] = [];
    for (const element of this.suggestionFields()) {
      const { field } = element;
      const draft = element.draft();
      if (field === undefined || draft === undefined) {
        return undefined;
      }
      const { replacement } = draft;
      fields.push({ ...field, replacement });
    }
    return { body: this.fieldText('body'), fields };
  }

  /**
   * Puts `text` in the body as one edit: selecting the whole body and inserting over it keeps
   * Chromium's undo stack, so ⌘/Ctrl+Z in the body brings the draft back too. Without that, it
   * sets the value.
   */
  private replaceBody(text: string): void {
    const body = this.field('body');
    if (!(body instanceof HTMLTextAreaElement)) {
      return;
    }
    body.focus({ preventScroll: true });
    body.select();
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- the one way to edit a field undoably.
    if (document.execCommand('insertText', false, text)) {
      return;
    }
    body.value = text;
    body.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  }

  /** Puts `form` in the form: its body, and its fields through the form's owner. */
  private fill(form: AutoeditForm): void {
    this.isApplying = true;
    try {
      this.replaceBody(form.body);
      const detail: SuggestionFieldsReplaceDetail = { fields: form.fields };
      this.dispatchEvent(
        new CustomEvent('beuve-suggestion-fields-replace', {
          detail,
          bubbles: true,
          composed: true,
        }),
      );
    } finally {
      this.isApplying = false;
    }
  }

  /** The field keys the form shows now, in order. */
  private fieldKeys(): string[] {
    return this.suggestionFields().flatMap((element) => {
      return element.field?.key ?? [];
    });
  }

  /**
   * The owner renders the fields after an autoedit or undo; any other change to them (Add
   * suggestion, a field's Remove, Add Suggestion… from the diff) is the reviewer's edit.
   */
  private onFieldsMutated(): void {
    const { undoState } = this;
    if (undoState === undefined) {
      return;
    }
    const keys = this.fieldKeys().join('\n');
    const before = undoState.before.fields.map((field) => field.key).join('\n');
    if (keys === before || keys === undoState.keys.join('\n')) {
      return;
    }
    this.dropUndo();
  }

  private dropUndo(): void {
    this.undoState = undefined;
  }

  private apply(
    before: AutoeditForm,
    outcome: Extract<NoteAutoeditOutcome, { kind: 'autoedited' }>,
  ): void {
    const after = autoeditedFormFrom(before, outcome, {
      headSha: outcome.headSha,
      newKey: (): string => {
        return `autoedit-${crypto.randomUUID()}`;
      },
    });
    this.fill(after);
    this.undoState = {
      before,
      keys: after.fields.map((field) => field.key),
      dropped: outcome.dropped,
    };
  }

  private renderUndo(): TemplateResult | typeof nothing {
    const { undoState } = this;
    if (undoState === undefined) {
      return nothing;
    }
    return html`<button
        class="button link"
        type="button"
        title="Put the body and suggestions back as they were before the autoedit"
        @click=${this.onUndo}
      >
        Undo autoedit
      </button>
      ${
        undoState.dropped === 0
          ? nothing
          : html`<span class="status" role="status"
              >${countNoun(undoState.dropped, 'invalid suggestion')} left out</span
            >`
      }`;
  }

  override connectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.connectedCallback();
    this.form = this.closest('form') ?? undefined;
    this.form?.addEventListener('input', this.onFormInput);
    this.form?.addEventListener('beuve-suggestion-field-edit', this.onFieldEdit);
    if (this.form !== undefined) {
      this.fieldsObserver.observe(this.form, { childList: true, subtree: true });
    }
    queueMicrotask(this.onHasText);
  }

  override disconnectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.disconnectedCallback();
    this.form?.removeEventListener('input', this.onFormInput);
    this.form?.removeEventListener('beuve-suggestion-field-edit', this.onFieldEdit);
    this.fieldsObserver.disconnect();
    this.form = undefined;
    this.controller?.abort();
  }

  /** Asks for the autoedit, unless one is running or there is nothing to autoedit. */
  async autoedit(): Promise<void> {
    const { anchor } = this;
    if (anchor === undefined || this.isAutoediting) {
      return;
    }
    const title = this.fieldText('title');
    const before = this.currentForm();
    if (before === undefined) {
      this.error = 'Wait for the suggestions to read their lines.';
      return;
    }
    if (title.trim() === '' && before.body.trim() === '') {
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    let answer: Promise<NoteAutoeditOutcome> | undefined;
    const detail: NoteAutoeditRequestDetail = {
      draft: {
        anchor,
        ...(this.headSha !== '' && { headSha: this.headSha }),
        noteKey: this.noteKey,
        severity: this.severity(),
        blocking: this.isBlocking(),
        title,
        body: before.body,
        suggestions: before.fields.map((field): AutoeditSuggestionDraftView => {
          const { key, path, startLine, endLine } = field;
          return { key, path, startLine, endLine, replacement: field.replacement ?? '' };
        }),
      },
      signal: controller.signal,
      respond: (outcome): void => {
        answer = outcome;
      },
    };
    this.dispatchEvent(
      new CustomEvent('beuve-note-autoedit-request', { detail, bubbles: true, composed: true }),
    );
    if (answer === undefined) {
      this.error = 'Autoediting needs an open review.';
      return;
    }
    this.error = '';
    this.undoState = undefined;
    this.isAutoediting = true;
    const outcome = await answer;
    if (this.controller === controller) {
      this.controller = undefined;
      this.isAutoediting = false;
    }
    if (!this.isConnected || controller.signal.aborted) {
      return;
    }
    switch (outcome.kind) {
      case 'autoedited': {
        this.apply(before, outcome);
        return;
      }
      case 'failed': {
        this.error = outcome.message;
        return;
      }
      case 'cancelled': {
        return;
      }
    }
  }

  /** Undo autoedit: the body and every field as they were before the request. */
  undo(): void {
    const { undoState } = this;
    if (undoState === undefined) {
      return;
    }
    this.undoState = undefined;
    this.fill(undoState.before);
  }

  override render(): TemplateResult {
    if (this.isAutoediting) {
      return html`<span class="status" role="status">Autoediting…</span>
        <button
          class="button link"
          type="button"
          title="Stop autoediting; the draft stays as it is"
          @click=${this.onStop}
        >
          Stop
        </button>`;
    }
    return html`${this.error === '' ? nothing : html`<span class="error" role="alert">${this.error}</span>`}
      <button
        class="button"
        type="button"
        title="Autoedit this note: Claude rewrites it for the author from your draft and the diff, and adds or revises suggestions only where the draft asks for a code change"
        ?disabled=${!this.hasText || this.anchor === undefined}
        @click=${this.onAutoedit}
      >
        ✨ Autoedit
      </button>
      ${this.renderUndo()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-note-autoedit': BeuveNoteAutoedit;
  }
}
