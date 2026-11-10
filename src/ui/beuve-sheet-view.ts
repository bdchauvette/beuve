import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type {
  DiagnosticItemView,
  IpcResult,
  PermalinkView,
  SheetApi,
  SheetFileView,
  SheetNoteView,
  SheetRangeView,
} from '#contract/ipc-contract.ts';

import type { CommandId, MenuCondition } from '#contract/command-catalog.ts';
import { revealFormatControls } from '#x/text/reveal-format-controls.ts';

import './beuve-definition-link.ts';
import type { BeuveDefinitionLink, DefinitionAsk } from './beuve-definition-link.ts';
import './beuve-hover-card.ts';
import type { BeuveHoverCard, DiagnosticsFor, HoverAsk } from './beuve-hover-card.ts';
import { diagnosticsAt } from './diagnostics-at.ts';
import type { DiagnosticPosition } from './diagnostics-at.ts';
import { DiagnosticsController } from './diagnostics-controller.ts';
import type { DiagnosticsTarget } from './diagnostics-controller.ts';
import './beuve-sheet-code.ts';
import type {
  BeuveSheetCode,
  SheetSelectDetail,
  SheetTokenDetail,
  SheetTokenHoverDetail,
} from './beuve-sheet-code.ts';
import { findSheetMatches } from './find-sheet-matches.ts';
import type { SheetMatch } from './find-sheet-matches.ts';
import { SelectionMatches } from './selection-matches.ts';
import { sheetRequestFrom } from './sheet-request-from.ts';
import { sheetTitleFrom } from './sheet-title-from.ts';
import { stepSheetHistory } from './step-sheet-history.ts';
import { withShortcut } from './with-shortcut.ts';
import type { SheetHistory, SheetHistoryState, SheetPlace } from './step-sheet-history.ts';
import { formatControlStyles } from './format-control-styles.ts';
import { applyFonts } from './apply-fonts.ts';
import { pathText } from './path-text.ts';
import { buttonStyles } from './primitives/button-styles.ts';
import { segmentedStyles } from './primitives/segmented-styles.ts';
import './primitives/beuve-time.ts';
import './rich-view/beuve-rich-view.ts';
import type {
  BeuveRichView,
  ImageLoader,
  RichAnnotation,
  RichLinkDetail,
  RichSelectDetail,
} from './rich-view/beuve-rich-view.ts';
import { changeRunsFromMarks } from './rich-view/change-runs-from-marks.ts';
import { richViewKindFrom } from './rich-view/rich-view-kind-from.ts';
import { uraBlockingEmoji } from './ura-blocking-emoji.ts';
import { uraSeverityEmoji } from './ura-severity-emoji.ts';

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
    buttonStyles,
    segmentedStyles,
    formatControlStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        block-size: 100%;
        min-block-size: 0;
        background: var(--beuve-code-bg);
        color: var(--beuve-code-text);
        outline: none;
      }

      header {
        display: flex;
        align-items: center;
        gap: var(--beuve-space-2);
        padding: var(--beuve-space-2) var(--beuve-space-3);
        border-block-end: var(--beuve-border-width) solid var(--beuve-border);
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
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font: var(--beuve-font-code);
        -webkit-app-region: drag;
      }

      .stamp {
        color: var(--beuve-text-muted);
        white-space: nowrap;
      }

      .find {
        display: flex;
        gap: var(--beuve-space-2);
        align-items: center;
        padding: var(--beuve-space-1) var(--beuve-space-3);
        border-block-end: var(--beuve-border-width) solid var(--beuve-border);
        background: var(--beuve-surface-sunken);
        color: var(--beuve-text-muted);
        font: var(--beuve-font-small);
      }

      .find input {
        flex: 1;
        max-inline-size: var(--beuve-size-field-wide);
        padding: var(--beuve-space-0-5) var(--beuve-space-2);
        border: var(--beuve-border-width) solid var(--beuve-border);
        border-radius: var(--beuve-radius-small);
        background: var(--beuve-surface);
        color: var(--beuve-text);
        font: var(--beuve-font-code);
      }

      .body {
        flex: 1;
        min-block-size: 0;
        overflow: auto;
      }

      .sheet-note {
        display: flex;
        align-items: center;
        gap: var(--beuve-space-1);
        color: var(--beuve-text-muted);
        font: var(--beuve-font-small);
      }

      .sheet-note .dot {
        inline-size: var(--beuve-size-dot-small);
        block-size: var(--beuve-size-dot-small);
        border-radius: var(--beuve-radius-full);
        background: var(--beuve-violet);
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
        padding: var(--beuve-space-1) var(--beuve-space-3);
        border-block-start: var(--beuve-border-width) solid var(--beuve-border);
        background: var(--beuve-surface);
        color: var(--beuve-text-muted);
        font: var(--beuve-font-small);
      }

      footer .notice {
        flex: 1;
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--beuve-text);
      }

      footer .notice.error {
        color: var(--beuve-danger);
      }

      footer .info {
        flex: none;
        color: var(--beuve-accent);
        cursor: default;
      }
    `,
  ];

  /** The session head when the sheet was printed, from its first read. */
  private printedHead: string | undefined;
  private readonly files = new Map<string, Promise<IpcResult<SheetFileView>>>();
  private readonly printedAt = Temporal.Now.instant().toString();
  private lastMenuState: string | undefined;

  private readonly onFocusChange = (): void => {
    queueMicrotask(() => {
      this.syncMenuState();
    });
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    if (this.api === undefined) {
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
    if (this.api !== undefined) {
      // The Settings window may have changed the fonts meanwhile; sheets get no settings event.
      void this.readDisplay(this.api);
    }
  };

  private readonly close = (): void => {
    close();
  };

  private readonly askDefinition: DefinitionAsk = async (request) => {
    const bridge = this.api;
    if (bridge === undefined) {
      return { ok: false, error: { code: 'unsupported', message: 'no bridge' } };
    }
    return bridge.invoke('lsp:definition', request);
  };

  /** The language servers' diagnostics, which a sheet has only at the session head (ADR 0111). */
  private readonly fileDiagnostics = new DiagnosticsController(this, {
    bridge: (): SheetApi | undefined => {
      return this.api;
    },
    target: (): DiagnosticsTarget | undefined => {
      if (!this.isAtHead()) {
        return undefined;
      }
      return { sessionId: this.sessionId, headSha: this.sha };
    },
  });

  private readonly diagnosticsFor: DiagnosticsFor = (path, position: DiagnosticPosition) => {
    const file = this.fileDiagnostics.byPath.get(path);
    if (file?.kind !== 'ready' || !this.hasDiagnosticsOn) {
      return [];
    }
    return diagnosticsAt(file.view.diagnostics, position);
  };

  private readonly askHover: HoverAsk = async (request) => {
    const bridge = this.api;
    if (bridge === undefined) {
      return { ok: false, error: { code: 'unsupported', message: 'no bridge' } };
    }
    return bridge.invoke('lsp:hover', request);
  };

  /** A rendered file's images, read at this sheet's commit (ADR 0123). */
  private readonly loadImage: ImageLoader = async ({ path }): Promise<string | undefined> => {
    const image = await this.api?.invoke('media:get-image', {
      sessionId: this.sessionId,
      sha: this.sha,
      path,
    });
    if (image?.ok === true) {
      return image.value.uri;
    }
    return undefined;
  };

  private readonly onRichSelect = (event: CustomEvent<RichSelectDetail>): void => {
    const { side, lines } = event.detail.target;
    if (side === 'head') {
      this.cursor = { start: lines.start, end: lines.end };
    }
  };

  /**
   * A rendered file's link: another file of the repository shows in this sheet, at this commit,
   * and joins its history; a web link is copied, since a sheet opens nothing else (ADR 0067).
   */
  private readonly onRichLink = (event: CustomEvent<RichLinkDetail>): void => {
    const { target } = event.detail;
    if (target.kind === 'external') {
      void this.copyLink(target.href);
      return;
    }
    const place = this.current();
    const line = target.line ?? 1;
    const next: SheetPlace = { path: target.path, range: lineRange({ start: line, end: line }) };
    let history = this.history;
    if (place !== undefined && this.cursor !== undefined) {
      history = stepSheetHistory(history, {
        kind: 'visit',
        place: { path: place.path, range: lineRange(this.cursor) },
      });
    }
    this.history = stepSheetHistory(history, { kind: 'visit', place: next });
    void this.show(this.current() ?? next);
  };

  @property({ attribute: false }) accessor api: SheetApi | undefined;
  @property() accessor sessionId = '';
  /** The commit the sheet is pinned to. */
  @property() accessor sha = '';
  @property({ attribute: false }) accessor place: SheetPlace | undefined;
  /** `process.platform`'s shortcuts for the toolbar's tooltips (ADR 0068); none in a test. */
  @property({ attribute: false }) accessor shortcuts: {
    readonly back: string;
    readonly forward: string;
    readonly copyLink: string;
    readonly toggleRendered: string;
  } = { back: '', forward: '', copyLink: '', toggleRendered: '' };

  @state() accessor history: SheetHistory = { places: [], index: 0 };
  @state() accessor loaded: Loaded = { status: 'loading' };
  @state() accessor cursor: SheetSelectDetail | undefined;
  /** The column the last click landed on, for Go to Definition on that line. */
  @state() accessor column: { readonly line: number; readonly character: number } | undefined;
  @state() accessor find: FindState | undefined;
  @state() accessor notice: { readonly text: string; readonly isError: boolean } | undefined;
  /** When the session head moved on since the sheet was printed, the head now. */
  @state() accessor movedHead: string | undefined;
  /** The reviewer's View, Diff, Show Diagnostics, read each time a file is shown. */
  @state() accessor hasDiagnosticsOn = true;
  /** A Markdown file (ADR 0123) shows rendered unless the reviewer chose its source. */
  @state() accessor view: 'rendered' | 'source' = 'source';

  constructor() {
    super();
    // ADR 0126: other occurrences of the text selected in the code.
    this.addController(
      new SelectionMatches(() => {
        const root = this.code()?.codeRoot();
        if (root === undefined) {
          return [];
        }
        return [root];
      }),
    );
  }

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
        if (this.isRendered()) {
          return this.renderRich(loaded.file);
        }
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
          .diagnostics=${this.shownDiagnostics()}
          @beuve-sheet-select=${(event: CustomEvent<SheetSelectDetail>): void => {
            this.cursor = event.detail;
          }}
          @beuve-sheet-token-hover=${(event: CustomEvent<SheetTokenHoverDetail>): void => {
            const path = this.current()?.path;
            if (path === undefined) {
              return;
            }
            this.hoverCard()?.point({ ...event.detail, path });
            this.definitionLink()?.point({ ...event.detail, path });
          }}
          @beuve-sheet-token-hover-end=${(): void => {
            this.hoverCard()?.leave();
            this.definitionLink()?.leave();
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

  private definitionLink(): BeuveDefinitionLink | undefined {
    return this.renderRoot.querySelector('beuve-definition-link') ?? undefined;
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
    if (this.api === undefined) {
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
    this.revealLine(clamped);
  }

  private code(): BeuveSheetCode | undefined {
    return this.renderRoot.querySelector('beuve-sheet-code') ?? undefined;
  }

  private rich(): BeuveRichView | undefined {
    return this.renderRoot.querySelector('beuve-rich-view') ?? undefined;
  }

  /** Scrolls line `line` into view: its region when rendered, the line in the source. */
  private revealLine(line: number): void {
    if (this.isRendered()) {
      void this.rich()?.reveal({ side: 'head', lines: { start: line, end: line } });
      return;
    }
    void this.code()?.reveal(line);
  }

  private isRendered(): boolean {
    return (
      this.view === 'rendered' &&
      this.loaded.status === 'ready' &&
      richViewKindFrom(this.loaded.file.path) !== undefined
    );
  }

  private async copyLink(url: string): Promise<void> {
    const copied = await this.api?.invoke('clipboard:write-text', { text: url });
    if (copied?.ok === true) {
      this.note(`Copied ${url}: a sheet opens no web pages.`, false);
      return;
    }
    this.note('The link could not be copied.', true);
  }

  /** Rendered and Source, for a Markdown file (ADR 0123). */
  private renderViewToggle(): TemplateResult | typeof nothing {
    if (this.loaded.status !== 'ready' || richViewKindFrom(this.loaded.file.path) === undefined) {
      return nothing;
    }
    const isRendered = this.view === 'rendered';
    return html`<span class="segmented" role="radiogroup" aria-label="Show the file">
      <button
        type="button"
        role="radio"
        aria-checked=${isRendered ? 'true' : 'false'}
        title=${withShortcut({ label: 'Rendered', shortcut: this.shortcuts.toggleRendered })}
        @click=${(): void => {
          this.view = 'rendered';
        }}
      >
        Rendered
      </button>
      <button
        type="button"
        role="radio"
        aria-checked=${isRendered ? 'false' : 'true'}
        title=${withShortcut({ label: 'Source', shortcut: this.shortcuts.toggleRendered })}
        @click=${(): void => {
          this.view = 'source';
        }}
      >
        Source
      </button>
    </span>`;
  }

  /** The file rendered (ADR 0123): marks as region tints, the cursor and find hit outlined. */
  private renderRich(file: SheetFileView): TemplateResult {
    const match = this.find?.matches[this.find.index];
    let line = this.cursor;
    if (match !== undefined) {
      line = { start: match.line, end: match.line };
    }
    const annotations = file.notes.map((note, index): RichAnnotation => {
      return { slot: `note-${String(index)}`, line: note.endLine };
    });
    return html`<beuve-rich-view
      .path=${file.path}
      .head=${file.contents}
      .runs=${changeRunsFromMarks(file.marks)}
      .annotations=${annotations}
      .selected=${line === undefined ? undefined : ({ side: 'head', lines: line } as const)}
      .loadImage=${this.loadImage}
      @beuve-rich-select=${this.onRichSelect}
      @beuve-rich-link=${this.onRichLink}
      >${file.notes.map((note, index) => {
        return html`<div slot=${`note-${String(index)}`} class="sheet-note">
          <span class="dot"></span>${noteLabel(note)} · ${note.title}
        </div>`;
      })}</beuve-rich-view
    >`;
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
      this.revealLine(match.line);
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
    this.revealLine(match.line);
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
    void this.readDisplay(bridge);
    const isSameFile = this.loaded.status === 'ready' && place.path === this.loaded.file.path;
    if (!isSameFile) {
      this.loaded = { status: 'loading' };
      this.view = 'source';
      if (richViewKindFrom(place.path) !== undefined) {
        this.view = 'rendered';
      }
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
    this.revealLine(range?.startLine ?? 1);
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

  private async readDisplay(bridge: SheetApi): Promise<void> {
    const display = await bridge.invoke('display:get');
    if (!display.ok) {
      return;
    }
    this.hasDiagnosticsOn = display.value.showDiagnostics;
    applyFonts(display.value);
  }

  /** Whether the file on screen is the session head's: only then are there diagnostics. */
  private isAtHead(): boolean {
    return (
      this.loaded.status === 'ready' &&
      this.loaded.file.headSha === this.sha &&
      this.movedHead === undefined
    );
  }

  /** The diagnostics of the file on screen, when it is the head's and the servers have answered. */
  private shownDiagnostics(): readonly DiagnosticItemView[] {
    if (this.loaded.status !== 'ready' || !this.hasDiagnosticsOn) {
      return [];
    }
    const file = this.fileDiagnostics.byPath.get(this.loaded.file.path);
    if (file?.kind !== 'ready') {
      return [];
    }
    return file.view.diagnostics;
  }

  /** A quiet heads-up, not a warning: a sheet at an older commit has no diagnostics (ADR 0111). */
  private renderDiagnosticsInfo(): TemplateResult | typeof nothing {
    if (this.loaded.status !== 'ready' || this.isAtHead()) {
      return nothing;
    }
    const text = 'Diagnostics are only shown at the session head.';
    return html`<span class="info" role="img" title=${text} aria-label=${text}>ⓘ</span>`;
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
      case 'toggle-rendered': {
        if (this.view === 'rendered') {
          this.view = 'source';
        } else {
          this.view = 'rendered';
        }
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
    if (this.loaded.status === 'ready' && this.isAtHead()) {
      this.fileDiagnostics.want(this.loaded.file.path);
    }
  }

  override render(): TemplateResult {
    const place = this.current();
    const line = this.cursor?.start ?? place?.range?.startLine;
    let title = '';
    if (place !== undefined) {
      title = sheetTitleFrom({ path: place.path, sha: this.sha, line });
    }
    if (title !== '') {
      document.title = revealFormatControls(title);
    }
    const { index, places } = this.history;
    return html`
      <header>
        <button
          class="button"
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
          class="button"
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
        ${this.renderViewToggle()}
        <span class="stamp"
          >printed <beuve-time datetime=${this.printedAt} time-style="short"></beuve-time
        ></span>
        <button
          class="button"
          type="button"
          title=${withShortcut({ label: 'Copy GitHub Permalink', shortcut: this.shortcuts.copyLink })}
          @click=${(): void => {
            void this.permalink(false);
          }}
        >
          Copy link
        </button>
        <button
          class="button"
          type="button"
          title="Open these lines on GitHub"
          @click=${(): void => {
            void this.permalink(true);
          }}
        >
          Open on GitHub
        </button>
      </header>
      ${this.find === undefined ? nothing : this.renderFind(this.find)}
      <div class="body">${this.renderBody()}</div>
      <footer>
        <span class="notice ${this.notice?.isError === true ? 'error' : ''}"
          >${this.notice?.text ?? this.headNote()}</span
        >
        ${this.renderDiagnosticsInfo()}
      </footer>
      <beuve-hover-card
        .ask=${this.askHover}
        .diagnosticsFor=${this.diagnosticsFor}
        .sessionId=${this.sessionId}
        .sha=${this.sha}
      ></beuve-hover-card>
      <beuve-definition-link
        .ask=${this.askDefinition}
        .sessionId=${this.sessionId}
        .sha=${this.sha}
      ></beuve-definition-link>
    `;
  }
}

/** `⚠️ issue`, after 🛑 and with `(blocking)` when the note blocks (ADR 0131). */
function noteLabel(note: SheetNoteView): string {
  const label = `${uraSeverityEmoji(note.severity)} ${note.severity}`;
  if (note.blocking) {
    return `${uraBlockingEmoji} ${label} (blocking)`;
  }
  return label;
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
