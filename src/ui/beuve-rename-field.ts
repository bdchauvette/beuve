import { LitElement, css, html, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';

import type { RenamePreviewView } from '#contract/ipc-contract.ts';

import { formatControlStyles } from './format-control-styles.ts';
import { pathText } from './path-text.ts';
import type { HoverAnchor } from './place-hover-card.ts';
import { placeHoverCard } from './place-hover-card.ts';
import { buttonStyles } from './primitives/button-styles.ts';
import { fieldStyles } from './primitives/field-styles.ts';
import { renameLeftOutLines } from './rename-left-out-lines.ts';
import { renderInlineTitle } from './render-inline-title.ts';

/** What `prepareRename` gave: the name to offer, or why there is none. */
export type RenameNaming =
  | { readonly kind: 'ready'; readonly placeholder: string }
  | { readonly kind: 'refused'; readonly message: string }
  | { readonly kind: 'cancelled' };

/** What asking for the rename gave: a preview, a hand-over to another window, or a failure. */
export type RenameAsked =
  | { readonly kind: 'preview'; readonly preview: RenamePreviewView }
  | { readonly kind: 'handed'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'cancelled' };

/** The window's side of Suggest Rename… (ADR 0163): the requests, and staging the note. */
export interface RenameFieldHost {
  readonly prepare: () => Promise<RenameNaming>;
  readonly rename: (newName: string) => Promise<RenameAsked>;
  /** Stages the previewed note: `undefined` once staged, else why not. */
  readonly stage: (preview: RenamePreviewView) => Promise<string | undefined>;
}

/** Where the field opens and what it runs; with `newName`, it asks for that rename at once. */
export interface RenameFieldOpening {
  /** The token, to open under; else the field opens at the top of {@link frame}. */
  readonly anchor: Element | undefined;
  /**
   * Without a token, the element whose top the field opens at, centered on it, so it covers no
   * band above it; without either, the top of the window.
   */
  readonly frame?: Element | undefined;
  readonly host: RenameFieldHost;
  readonly newName?: string;
}

type FieldState =
  | { readonly kind: 'closed' }
  | { readonly kind: 'busy'; readonly text: string }
  | { readonly kind: 'naming'; readonly oldName: string }
  | { readonly kind: 'message'; readonly text: string; readonly isError: boolean }
  | { readonly kind: 'preview'; readonly preview: RenamePreviewView };

/**
 * Suggest Rename… (ADR 0163): a small top-layer popover at the token. It asks `prepareRename`,
 * offers the placeholder selected in a name field (Return asks for the rename, Escape cancels,
 * the same name does nothing), shows a refusal in place, then previews the note (its files with
 * their change counts, and what was left out) for Stage or Cancel. Emits `beuve-rename-closed`
 * when it closes, so the window puts the focus back.
 */
@customElement('beuve-rename-field')
export class BeuveRenameField extends LitElement {
  static override styles = [
    buttonStyles,
    fieldStyles,
    formatControlStyles,
    css`
      :host {
        display: contents;
      }

      .card {
        position: fixed;
        inset: auto;
        box-sizing: border-box;
        inline-size: max-content;
        min-inline-size: var(--beuve-size-popover-min);
        max-inline-size: min(
          var(--beuve-size-popover),
          calc(var(--beuve-size-window-inline) - 2 * var(--beuve-space-2))
        );
        max-block-size: var(--beuve-size-window-block-50);
        margin: 0;
        padding: var(--beuve-space-2) var(--beuve-space-3);
        overflow: auto;
        border: var(--beuve-border-width) solid var(--beuve-border);
        border-radius: var(--beuve-radius);
        background: var(--beuve-surface);
        box-shadow: var(--beuve-shadow-small);
        color: var(--beuve-text);
        font: var(--beuve-font-small);
      }

      .field {
        inline-size: 100%;
        font-family: var(--beuve-font-family-code);
      }

      p,
      ul {
        margin: 0 0 var(--beuve-space-2);
      }

      ul {
        padding-inline-start: var(--beuve-space-4);
      }

      .title {
        font-weight: var(--beuve-font-weight-semibold);
        overflow-wrap: anywhere;
      }

      .title code {
        padding: 0 var(--beuve-space-0-5);
        border-radius: var(--beuve-radius-small);
        background: var(--beuve-surface-sunken);
        font: var(--beuve-font-code);
      }

      .hint,
      .count {
        color: var(--beuve-text-muted);
      }

      .error {
        color: var(--beuve-danger);
      }

      .actions {
        display: flex;
        gap: var(--beuve-space-2);
        justify-content: flex-end;
      }
    `,
  ];

  private host: RenameFieldHost | undefined;
  private anchor: Element | undefined;
  private frame: Element | undefined;
  /** Bumped on every opening and close, so a late answer for an earlier one is dropped. */
  private generation = 0;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // The window's in-place keys (arrows, Home/End, Escape) are not for the field.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (!(event.key === 'Enter' && event.target instanceof HTMLInputElement)) {
      return;
    }

    event.preventDefault();
    this.submit();
  };

  private readonly onClose = (): void => {
    this.close();
  };

  private readonly onToggle = (event: ToggleEvent): void => {
    if (event.newState === 'closed') {
      this.close();
    }
  };

  @state() accessor shown: FieldState = { kind: 'closed' };

  private async prepare(generation: number): Promise<void> {
    const { host } = this;
    if (host === undefined) {
      return;
    }
    this.shown = { kind: 'busy', text: 'Asking the language server…' };
    const naming = await host.prepare();
    if (generation !== this.generation) {
      return;
    }
    switch (naming.kind) {
      case 'ready': {
        this.shown = { kind: 'naming', oldName: naming.placeholder };
        return;
      }
      case 'refused': {
        this.shown = { kind: 'message', text: naming.message, isError: false };
        return;
      }
      case 'cancelled': {
        this.close();
        return;
      }
    }
  }

  private async ask(newName: string, generation: number): Promise<void> {
    const { host } = this;
    if (host === undefined) {
      return;
    }
    this.shown = { kind: 'busy', text: `Asking the language server to rename to ${newName}…` };
    const asked = await host.rename(newName);
    if (generation !== this.generation) {
      return;
    }
    switch (asked.kind) {
      case 'preview': {
        this.shown = { kind: 'preview', preview: asked.preview };
        return;
      }
      case 'handed': {
        this.shown = { kind: 'message', text: asked.message, isError: false };
        return;
      }
      case 'failed': {
        this.shown = { kind: 'message', text: asked.message, isError: true };
        return;
      }
      case 'cancelled': {
        this.close();
        return;
      }
    }
  }

  private submit(): void {
    const { shown } = this;
    const input = this.renderRoot.querySelector<HTMLInputElement>('input');
    if (input === null || shown.kind !== 'naming') {
      return;
    }
    const newName = input.value.trim();
    if (newName === '' || newName === shown.oldName) {
      this.close();
      return;
    }
    void this.ask(newName, this.generation);
  }

  private async stage(preview: RenamePreviewView): Promise<void> {
    const { host } = this;
    if (host === undefined) {
      return;
    }
    const generation = this.generation;
    this.shown = { kind: 'busy', text: 'Staging…' };
    const failure = await host.stage(preview);
    if (generation !== this.generation) {
      return;
    }
    if (failure === undefined) {
      this.close();
      return;
    }
    this.shown = { kind: 'message', text: failure, isError: true };
  }

  private renderContent(): TemplateResult | typeof nothing {
    const { shown } = this;
    switch (shown.kind) {
      case 'closed': {
        return nothing;
      }
      case 'busy': {
        return html`<p class="hint" role="status">${shown.text}</p>`;
      }
      case 'naming': {
        return html`<input
            class="field"
            aria-label="New name for ${shown.oldName}"
            spellcheck="false"
            autocomplete="off"
            .value=${shown.oldName}
          />
          <p class="hint">Return suggests the rename; Escape cancels.</p>`;
      }
      case 'message': {
        return html`<p class=${shown.isError ? 'error' : 'hint'} role="status">${shown.text}</p>
          <div class="actions">
            <button class="button" @click=${this.onClose}>Close</button>
          </div>`;
      }
      case 'preview': {
        return this.renderPreview(shown.preview);
      }
    }
  }

  private renderPreview(preview: RenamePreviewView): TemplateResult {
    const { files } = preview;
    const changes = files.reduce((sum, file) => {
      return sum + file.suggestions.length;
    }, 0);
    const leftOut = renameLeftOutLines(preview.leftOut);
    let summary = html`<p>The language server suggests no change.</p>`;
    if (files.length > 0) {
      summary = html`<p>
          One note with ${countOf(changes, 'suggestion')} in ${countOf(files.length, 'file')}:
        </p>
        <ul>
          ${files.map((file) => {
            return html`<li title=${file.path}>
              ${pathText(file.path)}
              <span class="count">${countOf(file.suggestions.length, 'change')}</span>
            </li>`;
          })}
        </ul>`;
    }
    return html`<p class="title">${renderInlineTitle(preview.title)}</p>
      ${summary}
      ${
        leftOut.length === 0
          ? nothing
          : html`<ul class="hint">
              ${leftOut.map((line) => {
                return html`<li>${line}</li>`;
              })}
            </ul>`
      }
      <div class="actions">
        <button class="button" @click=${this.onClose}>Cancel</button>
        <button
          class="button primary"
          ?disabled=${files.length === 0}
          @click=${(): void => {
            void this.stage(preview);
          }}
        >
          Stage
        </button>
      </div>`;
  }

  /** Under the token (or above it when there is no room), else at the top of the frame or window. */
  private place(card: HTMLElement): void {
    const { width, height } = card.getBoundingClientRect();
    let anchor: HoverAnchor = { x: (innerWidth - width) / 2, top: 0, bottom: 0 };
    if (this.anchor?.isConnected === true) {
      const bounds = this.anchor.getBoundingClientRect();
      anchor = { x: bounds.left, top: bounds.top, bottom: bounds.bottom };
    } else if (this.frame?.isConnected === true) {
      const bounds = this.frame.getBoundingClientRect();
      anchor = { x: bounds.left + (bounds.width - width) / 2, top: bounds.top, bottom: bounds.top };
    }
    const { left, top } = placeHoverCard(
      anchor,
      { width, height },
      { width: innerWidth, height: innerHeight },
    );
    card.style.left = `${String(left)}px`;
    card.style.top = `${String(top)}px`;
  }

  /** Opens the field for a token (or straight on a rename, with `newName`). */
  open(opening: RenameFieldOpening): void {
    this.generation += 1;
    this.host = opening.host;
    this.anchor = opening.anchor;
    this.frame = opening.frame;
    if (opening.newName === undefined) {
      void this.prepare(this.generation);
    } else {
      void this.ask(opening.newName, this.generation);
    }
  }

  /** Closes it, as Escape and Cancel do. */
  close(): void {
    if (this.shown.kind === 'closed') {
      return;
    }
    this.generation += 1;
    this.shown = { kind: 'closed' };
    this.dispatchEvent(new CustomEvent('beuve-rename-closed', { bubbles: true, composed: true }));
  }

  protected override updated(changed: PropertyValues<this>): void {
    const card = this.renderRoot.querySelector<HTMLElement>('.card');
    if (card === null || !changed.has('shown')) {
      return;
    }
    if (this.shown.kind === 'closed') {
      if (card.matches(':popover-open')) {
        card.hidePopover();
      }
      return;
    }
    if (!card.matches(':popover-open')) {
      card.showPopover();
    }
    this.place(card);
    if (this.shown.kind === 'naming') {
      this.renderRoot.querySelector<HTMLInputElement>('input')?.select();
    } else {
      const button =
        this.renderRoot.querySelector<HTMLElement>('.button.primary:not(:disabled)') ??
        this.renderRoot.querySelector<HTMLElement>('.button');
      button?.focus();
    }
  }

  protected override render(): TemplateResult {
    return html`<div
      class="card"
      popover="auto"
      role="dialog"
      aria-label="Suggest Rename"
      @keydown=${this.onKeyDown}
      @toggle=${this.onToggle}
    >
      ${this.renderContent()}
    </div>`;
  }
}

function countOf(count: number, noun: string): string {
  if (count === 1) {
    return `1 ${noun}`;
  }
  return `${String(count)} ${noun}s`;
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-rename-field': BeuveRenameField;
  }
}
