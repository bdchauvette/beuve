import { html, nothing } from 'lit';
import type { ReactiveController, ReactiveControllerHost, TemplateResult } from 'lit';

import { caretRectFrom } from './caret-rect-from.ts';
import { findEmojiQuery } from './find-emoji-query.ts';
import type { EmojiQuery, TextCaret } from './find-emoji-query.ts';
import { matchEmojiShortcodes } from './match-emoji-shortcodes.ts';
import type { EmojiSuggestion } from './match-emoji-shortcodes.ts';
import { planClosingColon } from './plan-closing-colon.ts';
import type { TextEdit } from './plan-closing-colon.ts';
import { placeHoverCard } from './place-hover-card.ts';
import { planCompletion } from './plan-completion.ts';

/** A Lit element whose shadow root holds the fields and the list. */
export type EmojiCompletionHost = ReactiveControllerHost &
  HTMLElement & { readonly renderRoot: HTMLElement | DocumentFragment };

type CompletionField = HTMLInputElement | HTMLTextAreaElement;

/**
 * `:shortcode:` completion for the host's text fields that carry `data-emoji-completion` (ADR
 * 0143). Typing `:` and two characters of a name lists up to eight emoji in a popover just below
 * the line the `:name` starts on, at its `:` (above it near the window's bottom); ↓ ↑ move, Enter
 * and Tab insert, Escape closes the list (and only the list), and a closing `:` after an exact
 * name inserts it as well. The emoji replaces the typed `:name` as one
 * undoable edit and fires the field's `input`. The keys it takes never reach the host's own
 * listeners; every other key, and every key while the list is closed, does.
 *
 * Create it as a field of the host (it adds itself as a controller), add `completionListStyles`
 * and `emojiCompletionStyles` to the host's styles, and render {@link render} once anywhere in
 * the shadow root. Each field carries the pattern's static half: an `<input>` is
 * `role="combobox"` with `aria-expanded="false"`; a `<textarea>` keeps its `textbox` role (ARIA in
 * HTML allows it no other, so it has no `aria-expanded`); both have `aria-autocomplete="list"`
 * and `aria-controls` naming the list.
 */
export class EmojiCompletion implements ReactiveController {
  private readonly host: EmojiCompletionHost;
  private readonly listId: string;
  private controller: AbortController | undefined;
  /** The field the list is for, while one has focus. */
  private field: CompletionField | undefined;
  /** The field whose ARIA state was last written, to clear it when another takes over. */
  private markedField: CompletionField | undefined;
  private query: EmojiQuery | undefined;
  /** Where the `:name` the reviewer closed the list on starts; it stays closed until that changes. */
  private dismissedAt: number | undefined;
  private suggestions: readonly EmojiSuggestion[] = [];
  private highlighted = 0;

  private readonly onKeyDown = (event: Event): void => {
    const field = completionFieldOf(event);
    if (field === undefined || !(event instanceof KeyboardEvent) || isModified(event)) {
      return;
    }
    if (event.key === ':') {
      const edit = planClosingColon(caretOf(field));
      if (edit !== undefined && field.selectionStart === field.selectionEnd) {
        event.preventDefault();
        event.stopPropagation();
        insert(field, edit);
      }
      return;
    }
    if (event.shiftKey || field !== this.field) {
      return;
    }
    const step = planCompletion({
      key: event.key,
      count: this.shownCount(),
      highlighted: this.highlighted,
    });
    if (step === undefined) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    switch (step.kind) {
      case 'highlight': {
        this.highlighted = step.index;
        this.host.requestUpdate();
        return;
      }
      case 'choose': {
        this.choose(step.index);
        return;
      }
      case 'dismiss': {
        this.dismissedAt = this.query?.start;
        this.host.requestUpdate();
        return;
      }
    }
  };

  /** Typing, moving the caret or focusing a field reads what is before the caret again. */
  private readonly onChange = (event: Event): void => {
    const field = completionFieldOf(event);
    if (field === undefined) {
      return;
    }
    this.field = field;
    this.sync(field);
  };

  /** The field, the host's scrolling or the window moved the `:name` under the open list. */
  private readonly onMove = (): void => {
    if (this.isOpen()) {
      this.place();
    }
  };

  private readonly onFocusOut = (event: Event): void => {
    if (completionFieldOf(event) === this.field) {
      this.close();
    }
  };

  /** Keeps focus, and the caret, in the field while an emoji is clicked. */
  private readonly onListPointerDown = (event: PointerEvent): void => {
    event.preventDefault();
  };

  private readonly onListClick = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) {
      return;
    }
    const option = event.target.closest<HTMLElement>('[data-index]');
    if (option !== null) {
      this.choose(Number(option.dataset['index']));
    }
  };

  constructor(host: EmojiCompletionHost, listId = 'emoji-completions') {
    this.host = host;
    this.listId = listId;
    host.addController(this);
  }

  private isOpen(): boolean {
    return (
      this.query !== undefined &&
      this.dismissedAt !== this.query.start &&
      this.suggestions.length > 0
    );
  }

  /** How many emoji the list shows: none while it is closed. */
  private shownCount(): number {
    if (!this.isOpen()) {
      return 0;
    }
    return this.suggestions.length;
  }

  private activeId(): string | undefined {
    if (!this.isOpen()) {
      return undefined;
    }
    return optionId(this.listId, this.highlighted);
  }

  /** The `:name` before a collapsed caret, and its matches; a new name starts at the top. */
  private sync(field: CompletionField): void {
    let query: EmojiQuery | undefined;
    if (field.selectionStart === field.selectionEnd) {
      query = findEmojiQuery(caretOf(field));
    }
    if (query?.start !== this.dismissedAt) {
      this.dismissedAt = undefined;
    }
    if (query?.start === this.query?.start && query?.name === this.query?.name) {
      if (field !== this.markedField) {
        this.host.requestUpdate();
      }
      return;
    }
    this.query = query;
    this.highlighted = 0;
    this.suggestions = [];
    if (query !== undefined) {
      this.suggestions = matchEmojiShortcodes(query.name);
    }
    this.host.requestUpdate();
  }

  private choose(index: number): void {
    const suggestion = this.suggestions[index];
    const { field, query } = this;
    if (suggestion === undefined || field === undefined || query === undefined) {
      return;
    }
    insert(field, { start: query.start, end: query.end, insert: suggestion.emoji });
  }

  private close(): void {
    this.reset();
    this.host.requestUpdate();
  }

  private reset(): void {
    this.field = undefined;
    this.query = undefined;
    this.dismissedAt = undefined;
    this.suggestions = [];
  }

  /**
   * Puts the open list just below the line the `:name` starts on, at its `:`, so it stays put
   * while the name is typed; above the line when there is no room below, and inside the window.
   */
  private place(): void {
    const list = this.host.renderRoot.querySelector<HTMLElement>(`#${this.listId}`);
    const { field, query } = this;
    if (list === null || field === undefined || query === undefined) {
      return;
    }
    const { width, height } = list.getBoundingClientRect();
    const { left, top } = placeHoverCard(
      caretRectFrom(field, query.start),
      { width, height },
      { width: innerWidth, height: innerHeight },
    );
    // The renderer is horizontal and left to right, so the viewport's x is the inline start.
    list.style.setProperty('inset-inline-start', `${String(left)}px`);
    list.style.setProperty('inset-block-start', `${String(top)}px`);
  }

  hostConnected(): void {
    this.controller?.abort();
    this.controller = new AbortController();
    const root = this.host.renderRoot;
    const { signal } = this.controller;
    // Capture, so a key the list takes is gone before the field's and the host's listeners.
    root.addEventListener('keydown', this.onKeyDown, { capture: true, signal });
    root.addEventListener('input', this.onChange, { signal });
    root.addEventListener('selectionchange', this.onChange, { signal });
    root.addEventListener('focusin', this.onChange, { signal });
    root.addEventListener('focusout', this.onFocusOut, { signal });
    // Scrolling does not bubble; capture sees the field's and every scroller's in the root.
    root.addEventListener('scroll', this.onMove, { capture: true, passive: true, signal });
    addEventListener('scroll', this.onMove, { capture: true, passive: true, signal });
    addEventListener('resize', this.onMove, { signal });
  }

  hostDisconnected(): void {
    this.controller?.abort();
    this.controller = undefined;
    this.close();
  }

  /** Shows or hides the popover at the `:name`, and points the field at the highlight. */
  hostUpdated(): void {
    // A field the host stopped rendering never reports losing focus.
    if (this.field?.isConnected === false) {
      this.reset();
    }
    const list = this.host.renderRoot.querySelector<HTMLElement>(`#${this.listId}`);
    const isOpen = this.isOpen();
    const { field } = this;
    if (this.markedField !== undefined && this.markedField !== field) {
      markField(this.markedField, undefined);
      this.markedField = undefined;
    }
    if (field !== undefined) {
      markField(field, this.activeId());
      this.markedField = field;
    }
    if (list === null) {
      return;
    }
    const isShown = list.matches(':popover-open');
    if (!isOpen || field === undefined) {
      if (isShown) {
        list.hidePopover();
      }
      return;
    }
    if (!isShown) {
      list.showPopover({ source: field });
    }
    this.place();
    list
      .querySelector(`#${optionId(this.listId, this.highlighted)}`)
      ?.scrollIntoView({ block: 'nearest' });
  }

  /** The listbox; empty, and hidden, while nothing is being completed. */
  render(): TemplateResult {
    return html`<div
      class="completion-list emoji-completions"
      id=${this.listId}
      role="listbox"
      aria-label="Emoji"
      popover="manual"
      @pointerdown=${this.onListPointerDown}
      @click=${this.onListClick}
    >
      ${
        this.isOpen()
          ? this.suggestions.map((suggestion, index) => {
              return html`<div
                class="completion"
                id=${optionId(this.listId, index)}
                role="option"
                aria-selected=${index === this.highlighted ? 'true' : 'false'}
                data-index=${index}
              >
                <span class="completion-emoji">${suggestion.emoji}</span>
                <span class="completion-name">:${suggestion.name}:</span>
              </div>`;
            })
          : nothing
      }
    </div>`;
  }
}

/** The field a key or input event came from, when it is one this completes. */
function completionFieldOf(event: Event): CompletionField | undefined {
  const [target] = event.composedPath();
  if (
    (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&
    target.dataset['emojiCompletion'] !== undefined &&
    !target.readOnly &&
    !target.disabled
  ) {
    return target;
  }
  return undefined;
}

function isModified(event: KeyboardEvent): boolean {
  return event.isComposing || event.ctrlKey || event.metaKey || event.altKey;
}

function caretOf(field: CompletionField): TextCaret {
  return { text: field.value, caret: field.selectionStart ?? 0 };
}

/**
 * Replaces the typed `:name` with the emoji. Inserting over a selection keeps Chromium's undo
 * stack, so ⌘/Ctrl+Z gives the `:name` back, and fires `input` as typing does. Without that, it
 * edits the value and fires `input` itself.
 */
function insert(field: CompletionField, edit: TextEdit): void {
  field.focus({ preventScroll: true });
  field.setSelectionRange(edit.start, edit.end);
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- the one way to edit a field undoably.
  if (document.execCommand('insertText', false, edit.insert)) {
    return;
  }
  field.setRangeText(edit.insert, edit.start, edit.end, 'end');
  field.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      composed: true,
      inputType: 'insertText',
      data: edit.insert,
    }),
  );
}

/**
 * Points the field at the highlighted option, and says whether an `<input>`'s list is open;
 * `active` is `undefined` while the list is closed. The template gives the field its static half.
 */
function markField(field: CompletionField, active: string | undefined): void {
  if (field instanceof HTMLInputElement) {
    field.setAttribute('aria-expanded', String(active !== undefined));
  }
  if (active !== undefined) {
    field.setAttribute('aria-activedescendant', active);
    return;
  }
  field.removeAttribute('aria-activedescendant');
}

/** The element id of the list's row `index`, for the field's `aria-activedescendant`. */
function optionId(listId: string, index: number): string {
  return `${listId}-${String(index)}`;
}
