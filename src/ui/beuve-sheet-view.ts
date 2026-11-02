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

import type { CommandId, MenuCondition } from '#contract/command-catalog.ts';
import { revealFormatControls } from '#x/text/reveal-format-controls.ts';

import './beuve-hover-card.ts';
import type { BeuveHoverCard, HoverAsk } from './beuve-hover-card.ts';
import './beuve-sheet-code.ts';
import type {
  BeuveSheetCode,
  SheetSelectDetail,
  SheetTokenDetail,
  SheetTokenHoverDetail,
} from './beuve-sheet-code.ts';
import { findSheetMatches } from './find-sheet-matches.ts';
import type { SheetMatch } from './find-sheet-matches.ts';
import { sheetRequestFrom } from './sheet-request-from.ts';
import { sheetTitleFrom } from './sheet-title-from.ts';
import { stepSheetHistory } from './step-sheet-history.ts';
import { withShortcut } from './with-shortcut.ts';
import type { SheetHistory, SheetHistoryState, SheetPlace } from './step-sheet-history.ts';
import { formatControlStyles } from './format-control-styles.ts';
import { pathText } from './path-text.ts';

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
 * the commit is the session head, a line cursor (↑/↓, Home/End, clicking a line), find (Enter and
 * Shift+Enter in the bar), and from the menus (ADR 0068) Go to Definition and Type Definition (and
 * ⌘-click) at the same commit, Back and Forward, Next and Previous Change over the marks, and
 * Copy GitHub Permalink and Open on GitHub. Esc or Close Window closes it. Never refreshed: when the session
 * head moves on, a quiet note says so.
 */
@customElement('beuve-sheet-view')
export class BeuveSheetView extends LitElement {
  static override styles = [
    formatControlStyles,
    css`
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
    `,
  ];

  /** The session head when the sheet was printed, from its first read. */
  private printedHead: string | undefined;
  private readonly files = new Map<string, Promise<IpcResult<SheetFileView>>>();
  private readonly printedAt = Temporal.Now.plainTimeISO().toString({ smallestUnit: 'minute' });
  private lastMenuState: string | undefined;

  private readonly onFocusChange = (): void => {
    queueMicrotask(() => {
      this.syncMenuState();
    });
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    if (this.mode !== 'window' || this.api === undefined) {
      return;
    }
    event.preventDefault();
    this.syncMenuState();
    void this.api.invoke('menu:context', {
      kind: contextMenuKind(this.shadowRoot),
      x: event.clientX,
      y: event.clientY,
    });
  };

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

  private readonly askHover: HoverAsk = async (request) => {
    const bridge = this.api;
    if (bridge === undefined) {
      return { ok: false, error: { code: 'unsupported', message: 'no bridge' } };
    }
    return bridge.invoke('lsp:hover', request);
  };

  @property({ attribute: false }) accessor api: SheetApi | undefined;
  @property() accessor sessionId = '';
  /** The commit the sheet is pinned to. */
  @property() accessor sha = '';
  @property({ attribute: false }) accessor place: SheetPlace | undefined;
  @property() accessor mode: SheetMode = 'window';
  /** `process.platform`'s shortcuts for the toolbar's tooltips (ADR 0068); none in a test. */
  @property({ attribute: false }) accessor shortcuts: {
    readonly back: string;
    readonly forward: string;
    readonly copyLink: string;
  } = { back: '', forward: '', copyLink: '' };

  @state() accessor history: SheetHistory = { places: [], index: 0 };
  @state() accessor loaded: Loaded = { status: 'loading' };
  @state() accessor cursor: SheetSelectDetail | undefined;
  /** The column the last click landed on, for Go to Definition on that line. */
  @state() accessor column: { readonly line: number; readonly character: number } | undefined;
  @state() accessor find: FindState | undefined;
  @state() accessor notice: { readonly text: string; readonly isError: boolean } | undefined;
  /** When the session head moved on since the sheet was printed, the head now. */
  @state() accessor movedHead: string | undefined;

  private renderFind(find: FindState): TemplateResult {
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
            if (event.shiftKey) {
              this.moveMatch(-1);
            } else {
              this.moveMatch(1);
            }
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.find = undefined;
            this.focus();
          }
        }}
      />
      <span>${matchCount(find)}</span>
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
          @beuve-sheet-token-hover=${(event: CustomEvent<SheetTokenHoverDetail>): void => {
            const path = this.current()?.path;
            if (path !== undefined) {
              this.hoverCard()?.point({ ...event.detail, path });
            }
          }}
          @beuve-sheet-token-hover-end=${(): void => {
            this.hoverCard()?.leave();
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

  private hoverCard(): BeuveHoverCard | undefined {
    return this.renderRoot.querySelector('beuve-hover-card') ?? undefined;
  }

  private headNote(): string {
    if (this.movedHead === undefined) {
      return `${this.sha.slice(0, 7)} · read-only`;
    }
    return `The session head has moved on to ${this.movedHead.slice(0, 7)} since this was printed.`;
  }

  /** The sheet's in-place keys (ADR 0068): ↑/↓ and Home/End move the line cursor, Esc closes. */
  private handleKey(event: KeyboardEvent): boolean {
    if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event)) {
      return false;
    }
    const keys: Readonly<Record<string, () => void>> = {
      ArrowDown: (): void => {
        this.moveCursor(1);
      },
      ArrowUp: (): void => {
        this.moveCursor(-1);
      },
      Home: (): void => {
        this.moveCursorTo(1);
      },
      End: (): void => {
        this.moveCursorTo(Number.MAX_SAFE_INTEGER);
      },
      Escape: (): void => {
        this.close();
      },
    };
    const run = keys[event.key];
    run?.();
    return run !== undefined;
  }

  /** Next or Previous Change in a sheet: the next block of the change's marks. */
  private moveToMark(step: 1 | -1): void {
    if (this.loaded.status !== 'ready') {
      return;
    }
    const { marks } = this.loaded.file;
    const starts = [
      ...new Set([
        ...marks.added.map((mark) => mark.startLine),
        ...marks.modified.map((mark) => mark.startLine),
        ...marks.deletedAt,
      ]),
    ].toSorted((left, right) => left - right);
    const from = this.cursor?.start ?? 0;
    let next = starts.findLast((line) => line < from);
    let edge = 'No more changes above.';
    if (step === 1) {
      next = starts.find((line) => line > from);
      edge = 'No more changes below.';
    }
    if (next === undefined) {
      this.note(edge, false);
      return;
    }
    this.notice = undefined;
    this.moveCursorTo(next);
  }

  /** Tells main which menu items the sheet window enables (ADR 0068). */
  private syncMenuState(): void {
    if (this.mode !== 'window' || this.api === undefined) {
      return;
    }
    const { canGoBack, canGoForward } = this.historyState();
    const conditions: MenuCondition[] = ['session'];
    if (this.loaded.status === 'ready') {
      conditions.push('file');
    }
    if (canGoBack) {
      conditions.push('back');
    }
    if (canGoForward) {
      conditions.push('forward');
    }
    if (isTypingNow(this.shadowRoot)) {
      conditions.push('text-focus');
    }
    const key = conditions.join(' ');
    if (key === this.lastMenuState) {
      return;
    }
    this.lastMenuState = key;
    void this.api.invoke('menu:set-state', { conditions, checked: [] });
  }

  private current(): SheetPlace | undefined {
    return this.history.places[this.history.index];
  }

  private lineCount(): number {
    if (this.loaded.status === 'ready') {
      return this.loaded.file.contents.split('\n').length;
    }
    return 1;
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
    let matches: readonly SheetMatch[] = [];
    if (this.loaded.status === 'ready') {
      matches = findSheetMatches({ query, text: this.loaded.file.contents });
    }
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
    if (!file.ok && this.files.get(place.path) === pending) {
      this.files.delete(place.path);
    }
    // A newer load superseded this one (ADR 0079); it ends quietly.
    if (this.current() !== place || (!file.ok && file.error.code === 'cancelled')) {
      return;
    }
    if (!file.ok) {
      this.loaded = { status: 'error', message: file.error.message };
      return;
    }
    this.loaded = { status: 'ready', file: file.value };
    this.printedHead ??= file.value.headSha;
    if (this.find !== undefined) {
      this.find = { ...this.find, matches: [], index: 0 };
      this.search(this.find.query);
    }
    const { range } = place;
    if (range === undefined) {
      this.cursor = undefined;
      this.column = undefined;
    } else {
      this.cursor = { start: range.startLine, end: range.endLine };
      this.column = { line: range.startLine, character: range.startCharacter };
    }
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
      this.note('Put the cursor on a line first (click a word, or use the arrow keys).', false);
      return;
    }
    this.note('Asking the language server…', false);
    const answer = await api.invoke('lsp:definition', {
      sessionId: this.sessionId,
      sha: this.sha,
      path: place.path,
      line,
      ...(this.column?.line === line && { character: this.column.character }),
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
    let channel: 'remote:permalink' | 'remote:open-permalink' = 'remote:permalink';
    if (isOpening) {
      channel = 'remote:open-permalink';
    }
    const link = await api.invoke(channel, request);
    if (!link.ok) {
      this.note(link.error.message, true);
      return;
    }
    if (isOpening || link.value.kind !== 'link') {
      this.note(describePermalink(link.value, isOpening), false);
      return;
    }
    const copied = await api.invoke('clipboard:write-text', { text: link.value.url });
    if (copied.ok) {
      this.note(`Copied ${link.value.url}`, false);
    } else {
      this.note(copied.error.message, true);
    }
  }

  private async checkHead(): Promise<void> {
    const { api } = this;
    const { printedHead } = this;
    if (api === undefined || printedHead === undefined || this.sessionId === '') {
      return;
    }
    const head = await api.invoke('sheet:get-head', { sessionId: this.sessionId });
    this.movedHead = undefined;
    if (head.ok && head.value.headSha !== printedHead) {
      this.movedHead = head.value.headSha;
    }
  }

  private note(text: string, isError: boolean): void {
    this.notice = { text, isError };
  }

  /**
   * Runs a menu command in the sheet (ADR 0068): its window's menu sends them, and in the main
   * window `beuve-app` hands them over while the inline sheet has the focus. True when handled.
   */
  runCommand(id: CommandId): boolean {
    switch (id) {
      case 'find': {
        this.find ??= { query: '', matches: [], index: 0 };
        void this.updateComplete.then(() => {
          this.renderRoot.querySelector<HTMLInputElement>('.find input')?.select();
        });
        return true;
      }
      case 'find-next': {
        this.moveMatch(1);
        return true;
      }
      case 'find-previous': {
        this.moveMatch(-1);
        return true;
      }
      case 'find-selection': {
        const selected = getSelection()?.toString().trim() ?? '';
        if (selected !== '' && !selected.includes('\n')) {
          this.search(selected);
        }
        return this.runCommand('find');
      }
      case 'back':
      case 'forward': {
        this.step(id);
        return true;
      }
      case 'next-hunk': {
        this.moveToMark(1);
        return true;
      }
      case 'previous-hunk': {
        this.moveToMark(-1);
        return true;
      }
      case 'open-definition': {
        void this.jump('definition');
        return true;
      }
      case 'open-type-definition': {
        void this.jump('type-definition');
        return true;
      }
      case 'copy-permalink':
      case 'open-permalink': {
        void this.permalink(id === 'open-permalink');
        return true;
      }
      default: {
        return false;
      }
    }
  }

  /** Whether Back and Forward have somewhere to go. */
  historyState(): SheetHistoryState {
    const { index, places } = this.history;
    return { canGoBack: index > 0, canGoForward: index < places.length - 1 };
  }

  override connectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.connectedCallback();
    this.tabIndex = 0;
    this.addEventListener('keydown', this.onKeyDown);
    this.addEventListener('focusin', this.onFocusChange);
    this.addEventListener('focusout', this.onFocusChange);
    this.addEventListener('contextmenu', this.onContextMenu);
    addEventListener('focus', this.onFocus);
  }

  override disconnectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.disconnectedCallback();
    this.removeEventListener('keydown', this.onKeyDown);
    this.removeEventListener('focusin', this.onFocusChange);
    this.removeEventListener('focusout', this.onFocusChange);
    this.removeEventListener('contextmenu', this.onContextMenu);
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

  protected override updated(): void {
    this.syncMenuState();
  }

  override render(): TemplateResult {
    const place = this.current();
    const line = this.cursor?.start ?? place?.range?.startLine;
    let title = '';
    if (place !== undefined) {
      title = sheetTitleFrom({ path: place.path, sha: this.sha, line });
    }
    if (title !== '' && this.mode === 'window') {
      document.title = revealFormatControls(title);
    }
    const { index, places } = this.history;
    return html`
      <header>
        <button
          type="button"
          title=${withShortcut({ label: 'Back', shortcut: this.shortcuts.back })}
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
          title=${withShortcut({ label: 'Forward', shortcut: this.shortcuts.forward })}
          aria-label="Forward"
          ?disabled=${index >= places.length - 1}
          @click=${(): void => {
            this.step('forward');
          }}
        >
          →
        </button>
        <span class="title" title=${`${place?.path ?? ''} at ${this.sha}`}>${pathText(title)}</span>
        <span class="stamp">printed ${this.printedAt}</span>
        <button
          type="button"
          title=${withShortcut({ label: 'Copy GitHub Permalink', shortcut: this.shortcuts.copyLink })}
          @click=${(): void => {
            void this.permalink(false);
          }}
        >
          Copy link
        </button>
        <button
          type="button"
          title="Open these lines on GitHub"
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
      </footer>
      <beuve-hover-card
        .ask=${this.askHover}
        .sessionId=${this.sessionId}
        .sha=${this.sha}
      ></beuve-hover-card>
    `;
  }
}

function lineRange(lines: SheetSelectDetail): SheetRangeView {
  return { startLine: lines.start, startCharacter: 0, endLine: lines.end, endCharacter: 0 };
}

function describePermalink(link: PermalinkView, isOpening: boolean): string {
  switch (link.kind) {
    case 'link': {
      if (isOpening) {
        return `Opened ${link.url}`;
      }
      return link.url;
    }
    case 'no-remote': {
      return 'This repository has no GitHub remote to link to.';
    }
  }
}

/** The find bar's count: none before a query, else where the current match is. */
function matchCount(find: FindState): string {
  if (find.query === '') {
    return '';
  }
  if (find.matches.length === 0) {
    return 'no matches';
  }
  return `${String(find.index + 1)} of ${String(find.matches.length)}`;
}

/** The text field's context menu while typing, the sheet's otherwise. */
function contextMenuKind(root: ShadowRoot | null): 'text' | 'sheet' {
  if (isTypingNow(root)) {
    return 'text';
  }
  return 'sheet';
}

function isTypingNow(root: ShadowRoot | null): boolean {
  const active = root?.activeElement;
  return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
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
