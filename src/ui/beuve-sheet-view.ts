import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type {
  IpcResult,
  PermalinkView,
  SheetApi,
  SheetFileView,
  SheetRangeView,
} from '#contract/ipc-contract.ts';

import './beuve-sheet-code.ts';
import type { BeuveSheetCode, SheetSelectDetail, SheetTokenDetail } from './beuve-sheet-code.ts';
import { findSheetMatches } from './find-sheet-matches.ts';
import type { SheetMatch } from './find-sheet-matches.ts';
import { sheetRequestFrom } from './sheet-request-from.ts';
import { sheetTitleFrom } from './sheet-title-from.ts';
import { stepSheetHistory } from './step-sheet-history.ts';
import type { SheetHistory, SheetPlace } from './step-sheet-history.ts';

/** Where a sheet lives: its own window, or the overlay in the main window (`/sheets inline`). */
export type SheetMode = 'window' | 'inline';

type Loaded =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly file: SheetFileView }
  | { readonly status: 'error'; readonly message: string };

interface FindState {
  readonly query: string;
  readonly matches: readonly SheetMatch[];
  readonly index: number;
}

/**
 * A sheet (ADR 0067): one file of a session as it is at one commit, like a printout of a draft.
 * Read-only and calm: line numbers, the change's marks against the review base, staged notes when
 * the commit is the session head, a line cursor (`j`/`k`, `g`/`Shift+g`), find (⌘F, Enter and
 * Shift+Enter or `n`/`Shift+n`), `Shift+d`/`Shift+t` (and ⌘-click) to follow a definition or a
 * type at the same commit, with back and forward (`[`/`]`, ⌘[/⌘]), `Shift+y` to copy a permalink
 * and `Shift+o` to open it on GitHub. Esc or ⌘W closes it. Never refreshed: when the session
 * head moves on, a quiet note says so.
 */
@customElement('beuve-sheet-view')
export class BeuveSheetView extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      background: var(--beuve-code-bg);
      color: var(--beuve-code-text);
      outline: none;
    }

    header {
      display: flex;
      align-items: center;
      gap: var(--beuve-space-2);
      padding: var(--beuve-space-2) var(--beuve-space-3);
      border-bottom: 1px solid var(--beuve-border);
      background: var(--beuve-surface);
      color: var(--beuve-text);
      font: var(--beuve-font-small);
      -webkit-app-region: drag;
    }

    header > * {
      -webkit-app-region: no-drag;
    }

    .title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font: var(--beuve-font-mono);
      -webkit-app-region: drag;
    }

    .stamp {
      color: var(--beuve-text-muted);
      white-space: nowrap;
    }

    button {
      padding: 1px var(--beuve-space-2);
      border: 1px solid var(--beuve-border);
      border-radius: 4px;
      background: var(--beuve-surface);
      color: var(--beuve-text);
      font: inherit;
      cursor: pointer;
    }

    button:disabled {
      color: var(--beuve-text-muted);
      cursor: default;
    }

    button:not(:disabled):hover,
    button:focus-visible {
      border-color: var(--beuve-accent);
      outline: none;
    }

    .find {
      display: flex;
      gap: var(--beuve-space-2);
      align-items: center;
      padding: var(--beuve-space-1) var(--beuve-space-3);
      border-bottom: 1px solid var(--beuve-border);
      background: var(--beuve-surface-sunken);
      color: var(--beuve-text-muted);
      font: var(--beuve-font-small);
    }

    .find input {
      flex: 1;
      max-width: 320px;
      padding: 2px var(--beuve-space-2);
      border: 1px solid var(--beuve-border);
      border-radius: 4px;
      background: var(--beuve-surface);
      color: var(--beuve-text);
      font: var(--beuve-font-mono);
    }

    .body {
      flex: 1;
      min-height: 0;
      overflow: auto;
    }

    .note {
      margin: 0;
      padding: var(--beuve-space-4);
      color: var(--beuve-text-muted);
      font: var(--beuve-font-body);
    }

    footer {
      display: flex;
      gap: var(--beuve-space-3);
      padding: 3px var(--beuve-space-3);
      border-top: 1px solid var(--beuve-border);
      background: var(--beuve-surface);
      color: var(--beuve-text-muted);
      font: var(--beuve-font-small);
    }

    footer .notice {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--beuve-text);
    }

    footer .notice.error {
      color: var(--beuve-danger);
    }

    kbd {
      font: var(--beuve-font-mono);
      font-size: 10.5px;
    }
  `;

  /** The session head when the sheet was printed, from its first read. */
  private printedHead: string | undefined;
  private readonly files = new Map<string, Promise<IpcResult<SheetFileView>>>();
  private readonly printedAt = Temporal.Now.plainTimeISO().toString({ smallestUnit: 'minute' });

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.handleKey(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  };

  private readonly onFocus = (): void => {
    void this.checkHead();
  };

  private readonly close = (): void => {
    if (this.mode === 'window') {
      close();
      return;
    }
    this.dispatchEvent(new CustomEvent('beuve-sheet-close', { bubbles: true, composed: true }));
  };

  @property({ attribute: false }) accessor api: SheetApi | undefined;
  @property() accessor sessionId = '';
  /** The commit the sheet is pinned to. */
  @property() accessor sha = '';
  @property({ attribute: false }) accessor place: SheetPlace | undefined;
  @property() accessor mode: SheetMode = 'window';

  @state() accessor history: SheetHistory = { places: [], index: 0 };
  @state() accessor loaded: Loaded = { status: 'loading' };
  @state() accessor cursor: SheetSelectDetail | undefined;
  /** The column the last click landed on, for `Shift+d` on that line. */
  @state() accessor column: { readonly line: number; readonly character: number } | undefined;
  @state() accessor find: FindState | undefined;
  @state() accessor notice: { readonly text: string; readonly isError: boolean } | undefined;
  /** When the session head moved on since the sheet was printed, the head now. */
  @state() accessor movedHead: string | undefined;

  private renderFind(find: FindState): TemplateResult {
    const count =
      find.query === ''
        ? ''
        : find.matches.length === 0
          ? 'no matches'
          : `${String(find.index + 1)} of ${String(find.matches.length)}`;
    return html`<div class="find">
      <input
        type="search"
        aria-label="Find in this file"
        placeholder="Find in this file"
        .value=${find.query}
        @input=${(event: InputEvent): void => {
          this.search((event.target as HTMLInputElement).value);
        }}
        @keydown=${(event: KeyboardEvent): void => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            this.moveMatch(event.shiftKey ? -1 : 1);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.find = undefined;
            this.focus();
          }
        }}
      />
      <span>${count}</span>
    </div>`;
  }

  private renderBody(): TemplateResult {
    const { loaded } = this;
    switch (loaded.status) {
      case 'loading': {
        return html`<p class="note">Reading the file…</p>`;
      }
      case 'error': {
        return html`<p class="note">${loaded.message}</p>`;
      }
      case 'ready': {
        const { find } = this;
        return html`<beuve-sheet-code
          .path=${loaded.file.path}
          .contents=${loaded.file.contents}
          .cacheKey=${loaded.file.sha}
          .marks=${loaded.file.marks}
          .notes=${loaded.file.notes}
          .matchLines=${find?.matches.map((match) => match.line) ?? []}
          .currentMatchLine=${find?.matches[find.index]?.line}
          .selected=${this.cursor}
          @beuve-sheet-select=${(event: CustomEvent<SheetSelectDetail>): void => {
            this.cursor = event.detail;
          }}
          @beuve-sheet-token=${(event: CustomEvent<SheetTokenDetail>): void => {
            const { line, character, isJump } = event.detail;
            this.column = { line, character };
            this.cursor = { start: line, end: line };
            if (isJump) {
              void this.jump('definition');
            }
          }}
        ></beuve-sheet-code>`;
      }
    }
  }

  private headNote(): string {
    return this.movedHead === undefined
      ? `${this.sha.slice(0, 7)} · read-only`
      : `The session head has moved on to ${this.movedHead.slice(0, 7)} since this was printed.`;
  }

  /** Every key the sheet knows; true when it handled `event`. */
  private handleKey(event: KeyboardEvent): boolean {
    const isCommand = event.metaKey || event.ctrlKey;
    const key = event.key;
    if (isCommand && key.toLowerCase() === 'f') {
      this.find ??= { query: '', matches: [], index: 0 };
      void this.updateComplete.then(() => {
        this.renderRoot.querySelector<HTMLInputElement>(':scope .find input')?.select();
      });
      return true;
    }
    if (isCommand && key.toLowerCase() === 'w') {
      this.close();
      return true;
    }
    if (isCommand && (key === '[' || key === ']')) {
      this.step(key === '[' ? 'back' : 'forward');
      return true;
    }
    if (event.altKey && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      this.step(key === 'ArrowLeft' ? 'back' : 'forward');
      return true;
    }
    return !isCommand && !event.altKey && !isTyping(event) && this.handlePlainKey(key);
  }

  private handlePlainKey(key: string): boolean {
    const keys: Readonly<Record<string, () => void>> = {
      j: (): void => {
        this.moveCursor(1);
      },
      ArrowDown: (): void => {
        this.moveCursor(1);
      },
      k: (): void => {
        this.moveCursor(-1);
      },
      ArrowUp: (): void => {
        this.moveCursor(-1);
      },
      g: (): void => {
        this.moveCursorTo(1);
      },
      G: (): void => {
        this.moveCursorTo(Number.MAX_SAFE_INTEGER);
      },
      n: (): void => {
        this.moveMatch(1);
      },
      N: (): void => {
        this.moveMatch(-1);
      },
      D: (): void => {
        void this.jump('definition');
      },
      T: (): void => {
        void this.jump('type-definition');
      },
      Y: (): void => {
        void this.permalink(false);
      },
      O: (): void => {
        void this.permalink(true);
      },
      '[': (): void => {
        this.step('back');
      },
      ']': (): void => {
        this.step('forward');
      },
      Escape: (): void => {
        this.close();
      },
    };
    const run = keys[key];
    run?.();
    return run !== undefined;
  }

  private current(): SheetPlace | undefined {
    return this.history.places[this.history.index];
  }

  private lineCount(): number {
    return this.loaded.status === 'ready' ? this.loaded.file.contents.split('\n').length : 1;
  }

  private moveCursor(delta: number): void {
    this.moveCursorTo((this.cursor?.start ?? this.current()?.range?.startLine ?? 0) + delta);
  }

  private moveCursorTo(line: number): void {
    const clamped = Math.min(Math.max(line, 1), this.lineCount());
    this.cursor = { start: clamped, end: clamped };
    void this.code()?.reveal(clamped);
  }

  private code(): BeuveSheetCode | undefined {
    return this.renderRoot.querySelector('beuve-sheet-code') ?? undefined;
  }

  private search(query: string): void {
    const matches =
      this.loaded.status === 'ready' ? findSheetMatches(this.loaded.file.contents, query) : [];
    const from = this.cursor?.start ?? 1;
    const index = Math.max(
      0,
      matches.findIndex((match) => match.line >= from),
    );
    this.find = { query, matches, index };
    const match = matches[index];
    if (match !== undefined) {
      void this.code()?.reveal(match.line);
    }
  }

  private moveMatch(delta: number): void {
    const { find } = this;
    if (find === undefined || find.matches.length === 0) {
      return;
    }
    const index = (find.index + delta + find.matches.length) % find.matches.length;
    this.find = { ...find, index };
    const match = find.matches[index];
    if (match === undefined) {
      return;
    }

    this.cursor = { start: match.line, end: match.line };
    this.column = { line: match.line, character: match.start };
    void this.code()?.reveal(match.line);
  }

  private step(direction: 'back' | 'forward'): void {
    const next = stepSheetHistory(this.history, { kind: direction });
    if (next === this.history) {
      return;
    }
    this.history = next;
    const place = this.current();
    if (place !== undefined) {
      void this.show(place);
    }
  }

  /** Loads (once per path) and shows a place, the cursor on its range. */
  private async show(place: SheetPlace): Promise<void> {
    const bridge = this.api;
    if (bridge === undefined) {
      this.loaded = { status: 'error', message: 'This sheet has no connection to beuve.' };
      return;
    }
    const isSameFile = this.loaded.status === 'ready' && place.path === this.loaded.file.path;
    if (!isSameFile) {
      this.loaded = { status: 'loading' };
    }
    let pending = this.files.get(place.path);
    if (pending === undefined) {
      pending = bridge.invoke('sheet:get-file', {
        sessionId: this.sessionId,
        sha: this.sha,
        path: place.path,
      });
      this.files.set(place.path, pending);
    }
    const file = await pending;
    if (this.current() !== place) {
      return;
    }
    if (!file.ok) {
      this.files.delete(place.path);
      this.loaded = { status: 'error', message: file.error.message };
      return;
    }
    this.loaded = { status: 'ready', file: file.value };
    this.printedHead ??= file.value.headSha;
    this.find = this.find === undefined ? undefined : { ...this.find, matches: [], index: 0 };
    if (this.find !== undefined) {
      this.search(this.find.query);
    }
    const { range } = place;
    this.cursor = range === undefined ? undefined : { start: range.startLine, end: range.endLine };
    this.column =
      range === undefined ? undefined : { line: range.startLine, character: range.startCharacter };
    await this.updateComplete;
    await this.code()?.updateComplete;
    void this.code()?.reveal(range?.startLine ?? 1);
  }

  /** Follows the definition (or type) of the token at the cursor, at this sheet's commit. */
  private async jump(kind: 'definition' | 'type-definition'): Promise<void> {
    const { api } = this;
    const place = this.current();
    const line = this.cursor?.start;
    if (api === undefined || place === undefined || line === undefined) {
      this.note('Put the cursor on a line first (j/k, or click a word).', false);
      return;
    }
    this.note('Asking the language server…', false);
    const column = this.column?.line === line ? this.column.character : undefined;
    const answer = await api.invoke('lsp:definition', {
      sessionId: this.sessionId,
      sha: this.sha,
      path: place.path,
      line,
      ...(column !== undefined && { character: column }),
      kind,
    });
    if (!answer.ok) {
      this.note(answer.error.message, true);
      return;
    }
    const request = sheetRequestFrom(this.sessionId, answer.value);
    if (typeof request === 'string') {
      this.note(request, false);
      return;
    }
    this.notice = undefined;
    const next: SheetPlace = { path: request.path, range: request.range };
    this.history = stepSheetHistory(
      stepSheetHistory(this.history, {
        kind: 'visit',
        place: { path: place.path, range: lineRange(this.cursor ?? { start: line, end: line }) },
      }),
      { kind: 'visit', place: next },
    );
    await this.show(this.current() ?? next);
  }

  private async permalink(isOpening: boolean): Promise<void> {
    const { api } = this;
    const place = this.current();
    if (api === undefined || place === undefined) {
      return;
    }
    const request = {
      sessionId: this.sessionId,
      sha: this.sha,
      path: place.path,
      ...(this.cursor !== undefined && {
        startLine: this.cursor.start,
        endLine: this.cursor.end,
      }),
    };
    const link = await api.invoke(
      isOpening ? 'remote:open-permalink' : 'remote:permalink',
      request,
    );
    if (!link.ok) {
      this.note(link.error.message, true);
      return;
    }
    if (isOpening || link.value.kind !== 'link') {
      this.note(describePermalink(link.value, isOpening), false);
      return;
    }
    const copied = await api.invoke('clipboard:write-text', { text: link.value.url });
    this.note(copied.ok ? `Copied ${link.value.url}` : copied.error.message, !copied.ok);
  }

  private async checkHead(): Promise<void> {
    const { api } = this;
    const { printedHead } = this;
    if (api === undefined || printedHead === undefined || this.sessionId === '') {
      return;
    }
    const head = await api.invoke('sheet:get-head', { sessionId: this.sessionId });
    this.movedHead = head.ok && head.value.headSha !== printedHead ? head.value.headSha : undefined;
  }

  private note(text: string, isError: boolean): void {
    this.notice = { text, isError };
  }

  override connectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.connectedCallback();
    this.tabIndex = 0;
    this.addEventListener('keydown', this.onKeyDown);
    addEventListener('focus', this.onFocus);
  }

  override disconnectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.disconnectedCallback();
    this.removeEventListener('keydown', this.onKeyDown);
    removeEventListener('focus', this.onFocus);
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!(changed.has('place') || changed.has('sha')) || this.place === undefined) {
      return;
    }

    this.files.clear();
    this.printedHead = undefined;
    this.history = { places: [this.place], index: 0 };
    this.movedHead = undefined;
    void this.show(this.place);
  }

  override render(): TemplateResult {
    const place = this.current();
    const line = this.cursor?.start ?? place?.range?.startLine;
    const title = place === undefined ? '' : sheetTitleFrom(place.path, this.sha, line);
    if (title !== '' && this.mode === 'window') {
      document.title = title;
    }
    const { index, places } = this.history;
    return html`
      <header>
        <button
          type="button"
          title="Back ([ or ⌘[)"
          aria-label="Back"
          ?disabled=${index === 0}
          @click=${(): void => {
            this.step('back');
          }}
        >
          ←
        </button>
        <button
          type="button"
          title="Forward (] or ⌘])"
          aria-label="Forward"
          ?disabled=${index >= places.length - 1}
          @click=${(): void => {
            this.step('forward');
          }}
        >
          →
        </button>
        <span class="title" title=${`${place?.path ?? ''} at ${this.sha}`}>${title}</span>
        <span class="stamp">printed ${this.printedAt}</span>
        <button
          type="button"
          title="Copy a permalink to these lines (Shift+y)"
          @click=${(): void => {
            void this.permalink(false);
          }}
        >
          Copy link
        </button>
        <button
          type="button"
          title="Open these lines on GitHub (Shift+o)"
          @click=${(): void => {
            void this.permalink(true);
          }}
        >
          Open on GitHub
        </button>
        ${
          this.mode === 'inline'
            ? html`<button type="button" title="Close (Esc)" @click=${this.close}>Close</button>`
            : nothing
        }
      </header>
      ${this.find === undefined ? nothing : this.renderFind(this.find)}
      <div class="body">${this.renderBody()}</div>
      <footer>
        <span class="notice ${this.notice?.isError === true ? 'error' : ''}"
          >${this.notice?.text ?? this.headNote()}</span
        >
        <span
          ><kbd>⇧D</kbd> definition · <kbd>⇧T</kbd> type · <kbd>[</kbd><kbd>]</kbd> history ·
          <kbd>⌘F</kbd> find · <kbd>Esc</kbd> close</span
        >
      </footer>
    `;
  }
}

function lineRange(lines: SheetSelectDetail): SheetRangeView {
  return { startLine: lines.start, startCharacter: 0, endLine: lines.end, endCharacter: 0 };
}

function describePermalink(link: PermalinkView, isOpening: boolean): string {
  switch (link.kind) {
    case 'link': {
      return isOpening ? `Opened ${link.url}` : link.url;
    }
    case 'no-remote': {
      return 'This repository has no GitHub remote to link to.';
    }
  }
}

function isTyping(event: KeyboardEvent): boolean {
  return event
    .composedPath()
    .some((target) => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement);
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-sheet-view': BeuveSheetView;
  }
}
