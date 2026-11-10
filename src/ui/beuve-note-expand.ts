import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type { UraAnchorView, UraSeverityView } from '#contract/ipc-contract.ts';

import { buttonStyles } from './primitives/button-styles.ts';

/** What "Expand on this" sends (ADR 0125): the note's fields as the form holds them now. */
export interface NoteExpandDraft {
  readonly anchor: UraAnchorView;
  /** The head the anchor refers to; the open review's head when absent. */
  readonly headSha?: string;
  /** Names the note, so a newer expansion of it replaces one in flight. */
  readonly noteKey: string;
  readonly severity: UraSeverityView;
  readonly blocking: boolean;
  readonly title: string;
  readonly body: string;
}

/** How an expansion ended. `cancelled` shows nothing. */
export type NoteExpandOutcome =
  | { readonly kind: 'expanded'; readonly body: string }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'cancelled' };

/**
 * `beuve-note-expand-request`: the draft, a signal that aborts when the reviewer cancels, and
 * `respond`, which whoever can reach main (the review) calls once, at once, with the answer.
 */
export interface NoteExpandRequestDetail {
  readonly draft: NoteExpandDraft;
  readonly signal: AbortSignal;
  readonly respond: (outcome: Promise<NoteExpandOutcome>) => void;
}

/**
 * The Expand button of a note form (ADR 0125), placed inside the `<form>` whose Title input, Body
 * textarea and Label select it reads (by their `aria-label`), and its Blocking toggle (`name`). Enabled while the title or body
 * has text. It asks with a composed `beuve-note-expand-request` ({@link NoteExpandRequestDetail})
 * and never calls the bridge; while it waits it shows Expanding… and a Cancel. The answer replaces
 * the body's text as one edit the reviewer can undo (⌘/Ctrl+Z); a failure shows beside the button.
 */
@customElement('beuve-note-expand')
export class BeuveNoteExpand extends LitElement {
  static override styles = [
    buttonStyles,
    css`
      :host {
        display: inline-flex;
        align-items: center;
        gap: var(--beuve-space-2);
        min-inline-size: 0;
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

  private readonly onFormInput = (): void => {
    this.hasText = this.fieldText('title').trim() !== '' || this.fieldText('body').trim() !== '';
  };

  private readonly onExpand = (): void => {
    void this.expand();
  };

  private readonly onCancel = (): void => {
    this.controller?.abort();
  };

  /** The note's anchor; without one the button stays disabled. */
  @property({ attribute: false }) accessor anchor: UraAnchorView | undefined;
  /** The head `anchor` refers to; empty for the open review's head. */
  @property() accessor headSha = '';
  @property() accessor noteKey = 'new';

  @state() accessor hasText = false;
  @state() accessor error = '';
  @state() accessor isExpanding = false;

  private field(name: 'title' | 'body' | 'severity' | 'blocking'): HTMLElement | undefined {
    const selectors = {
      title: 'input[aria-label="Title"]',
      body: 'textarea[aria-label="Body"]',
      severity: 'select[aria-label="Label"]',
      blocking: 'button[name="blocking"]',
    } as const;
    return this.form?.querySelector<HTMLElement>(selectors[name]) ?? undefined;
  }

  private fieldText(name: 'title' | 'body'): string {
    const element = this.field(name);
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return element.value;
    }
    return '';
  }

  private isBlocking(): boolean {
    return this.field('blocking')?.getAttribute('aria-pressed') === 'true';
  }

  private severity(): UraSeverityView {
    const element = this.field('severity');
    if (element instanceof HTMLSelectElement && element.value !== '') {
      return element.value as UraSeverityView;
    }
    return 'issue';
  }

  /**
   * Puts `text` in the body as one edit: selecting the whole body and inserting over it keeps
   * Chromium's undo stack, so ⌘/Ctrl+Z brings the draft back. Without that, it sets the value.
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

  override connectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.connectedCallback();
    this.form = this.closest('form') ?? undefined;
    this.form?.addEventListener('input', this.onFormInput);
    queueMicrotask(this.onFormInput);
  }

  override disconnectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.disconnectedCallback();
    this.form?.removeEventListener('input', this.onFormInput);
    this.form = undefined;
    this.controller?.abort();
  }

  /** Asks for the expansion, unless one is running or there is nothing to expand. */
  async expand(): Promise<void> {
    const { anchor } = this;
    if (anchor === undefined || this.isExpanding) {
      return;
    }
    const title = this.fieldText('title');
    const body = this.fieldText('body');
    if (title.trim() === '' && body.trim() === '') {
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    let answer: Promise<NoteExpandOutcome> | undefined;
    const detail: NoteExpandRequestDetail = {
      draft: {
        anchor,
        ...(this.headSha !== '' && { headSha: this.headSha }),
        noteKey: this.noteKey,
        severity: this.severity(),
        blocking: this.isBlocking(),
        title,
        body,
      },
      signal: controller.signal,
      respond: (outcome): void => {
        answer = outcome;
      },
    };
    this.dispatchEvent(
      new CustomEvent('beuve-note-expand-request', { detail, bubbles: true, composed: true }),
    );
    if (answer === undefined) {
      this.error = 'Expanding needs an open review.';
      return;
    }
    this.error = '';
    this.isExpanding = true;
    const outcome = await answer;
    if (this.controller === controller) {
      this.controller = undefined;
      this.isExpanding = false;
    }
    if (!this.isConnected || controller.signal.aborted) {
      return;
    }
    switch (outcome.kind) {
      case 'expanded': {
        this.replaceBody(outcome.body);
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

  override render(): TemplateResult {
    if (this.isExpanding) {
      return html`<span class="status" role="status">Expanding…</span>
        <button class="button link" type="button" @click=${this.onCancel}>Cancel</button>`;
    }
    return html`${this.error === '' ? nothing : html`<span class="error" role="alert">${this.error}</span>`}
      <button
        class="button"
        type="button"
        title="Expand on this: write the note out for the author from the draft and the diff"
        ?disabled=${!this.hasText || this.anchor === undefined}
        @click=${this.onExpand}
      >
        Expand
      </button>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-note-expand': BeuveNoteExpand;
  }
}
