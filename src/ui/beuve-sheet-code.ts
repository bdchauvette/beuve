import type * as Diffs from '@pierre/diffs';
import type { File, OnTokenEventProps, SelectedLineRange } from '@pierre/diffs';
import { css, html, LitElement } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type { DiagnosticItemView, SheetMarksView, SheetNoteView } from '#contract/ipc-contract.ts';

import { characterOffsetAt } from './character-offset-at.ts';
import { DiagnosticHighlights } from './diagnostic-highlights.ts';
import { diagnosticRangesFrom } from './diagnostic-ranges-from.ts';
import type { HoverPoint } from './hover-point.ts';
import { highlightedLanguages } from './highlighted-languages.ts';
import { languageFromShebang } from './language-from-shebang.ts';
import { sheetGutterCssFrom } from './sheet-gutter-css-from.ts';
import { diffsThemeNames } from './diffs-theme-names.ts';
import { loadDiffsLibrary } from './load-diffs-library.ts';

/** A token the reviewer clicked: 1-based line, 0-based UTF-16 column. */
export interface SheetTokenDetail {
  readonly line: number;
  readonly character: number;
  /** ⌘ (Ctrl elsewhere) was held: jump to its definition at once. */
  readonly isJump: boolean;
}

/** A token the pointer entered: what `HoverPoint` says, without the path (the sheet knows it). */
export type SheetTokenHoverDetail = Omit<HoverPoint, 'path'>;

/** Lines the reviewer selected with the mouse, 1-based and inclusive. */
export interface SheetSelectDetail {
  readonly start: number;
  readonly end: number;
}

/**
 * The code of a sheet (ADR 0067): a whole file through `@pierre/diffs`' `File`, highlighted with
 * beuve's syntax themes (ADR 0119), line numbers on, read-only. The gutter shows the change's
 * marks, staged notes and find hits (`sheetGutterCssFrom`); `selected` is the line cursor or the
 * jump's range. Emits `beuve-sheet-token` for a clicked token and `beuve-sheet-select` for
 * lines selected by mouse, and `beuve-sheet-token-hover` / `beuve-sheet-token-hover-end` as the
 * pointer enters and leaves a token (for the language server's hover). The library is a lazy chunk, as in the diff cards. `compact` is a
 * chat answer's fenced code (ADR 0073): no line numbers, selection or token clicks, and the plain
 * text until the library has loaded, so the block keeps its height.
 */
@customElement('beuve-sheet-code')
export class BeuveSheetCode extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    diffs-container {
      --diffs-font-family: var(--beuve-font-family-code);
      --diffs-font-size: var(--beuve-font-size-code);
      --diffs-line-height: var(--beuve-line-height-code);
      --diffs-bg-context-override: var(--beuve-code-bg);
      --diffs-bg-buffer-override: var(--beuve-code-bg);
      --diffs-bg-context-gutter-override: var(--beuve-code-bg);
      --diffs-fg-number-override: var(--beuve-text-muted);
      --diffs-bg-selection-override: var(--beuve-accent-soft);
      --diffs-bg-selection-number-override: var(--beuve-accent-soft);
      --diffs-selection-color-override: var(--beuve-accent);
      --diffs-bg-hover-override: var(--beuve-surface-sunken);
    }

    .plain {
      margin: 0;
      padding: var(--beuve-space-3);
      font: var(--beuve-font-code);
      white-space: pre;
      color: var(--beuve-code-text);
    }
  `;

  private view: File | undefined;
  private sheet: CSSStyleSheet | undefined;
  private renderedKey = '';
  /** This sheet's diagnostic underlines in the document's shared highlights. */
  private readonly diagnosticHighlights = new DiagnosticHighlights();

  @property() accessor path = '';
  @property() accessor contents = '';
  /** Names the snapshot (commit and path), so a re-render of the same text is free. */
  @property() accessor cacheKey = '';
  @property({ attribute: false }) accessor marks: SheetMarksView = {
    added: [],
    modified: [],
    deletedAt: [],
  };
  @property({ attribute: false }) accessor notes: readonly SheetNoteView[] = [];
  @property({ attribute: false }) accessor matchLines: readonly number[] = [];
  @property({ attribute: false }) accessor currentMatchLine: number | undefined;
  @property({ attribute: false }) accessor selected: SheetSelectDetail | undefined;
  /** The language servers' diagnostics for this file, when the sheet is at the session head (ADR 0111). */
  @property({ attribute: false }) accessor diagnostics: readonly DiagnosticItemView[] = [];
  /** A snippet in the chat: highlighted text only, nothing to click or select by line. */
  @property({ type: Boolean }) accessor compact = false;

  @state() accessor library: typeof Diffs | undefined;
  @state() accessor hasFailed = false;

  private createView(library: typeof Diffs): File {
    const options = {
      theme: diffsThemeNames,
      themeType: 'system',
      preferredHighlighter: 'shiki-js',
      disableFileHeader: true,
      overflow: 'scroll',
    } as const;
    if (this.compact) {
      return new library.File({
        ...options,
        disableLineNumbers: true,
        lineHoverHighlight: 'disabled',
      });
    }
    return new library.File({
      ...options,
      lineHoverHighlight: 'number',
      enableLineSelection: true,
      onLineSelected: (range: SelectedLineRange | null): void => {
        if (range === null) {
          return;
        }
        const detail: SheetSelectDetail = {
          start: Math.min(range.start, range.end),
          end: Math.max(range.start, range.end),
        };
        this.dispatchEvent(new CustomEvent('beuve-sheet-select', { detail, bubbles: true }));
      },
      onTokenClick: (props: OnTokenEventProps<'file'>, event: MouseEvent): void => {
        const detail: SheetTokenDetail = {
          line: props.lineNumber,
          character: props.lineCharStart + characterOffsetAt(props.tokenElement, event),
          isJump: event.metaKey || event.ctrlKey,
        };
        this.dispatchEvent(new CustomEvent('beuve-sheet-token', { detail, bubbles: true }));
      },
      onTokenEnter: (props: OnTokenEventProps<'file'>, event: PointerEvent): void => {
        const detail: SheetTokenHoverDetail = {
          line: props.lineNumber,
          lineCharStart: props.lineCharStart,
          tokenElement: props.tokenElement,
          clientX: event.clientX,
          clientY: event.clientY,
        };
        this.dispatchEvent(new CustomEvent('beuve-sheet-token-hover', { detail, bubbles: true }));
      },
      onTokenLeave: (): void => {
        this.dispatchEvent(new CustomEvent('beuve-sheet-token-hover-end', { bubbles: true }));
      },
      onPostRender: (_node, _instance, phase): void => {
        if (phase === 'unmount') {
          this.diagnosticHighlights.clear();
          return;
        }
        void this.syncGutter();
        this.syncDiagnostics();
      },
    });
  }

  private async syncGutter(): Promise<void> {
    const root = await waitFor(() => {
      return this.renderRoot.querySelector('diffs-container')?.shadowRoot ?? undefined;
    });
    if (root === undefined) {
      return;
    }
    const sheet = this.sheet ?? new CSSStyleSheet();
    this.sheet = sheet;
    sheet.replaceSync(
      sheetGutterCssFrom({
        marks: this.marks,
        notes: this.notes,
        matchLines: this.matchLines,
        currentMatchLine: this.currentMatchLine,
      }),
    );
    if (!root.adoptedStyleSheets.includes(sheet)) {
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    }
  }

  /** Underlines each diagnostic's text on the rows the sheet has rendered. */
  private syncDiagnostics(): void {
    this.diagnosticHighlights.set(diagnosticRangesFrom(this.diagnostics, (line) => this.row(line)));
  }

  private row(line: number): HTMLElement | undefined {
    const root = this.renderRoot.querySelector('diffs-container')?.shadowRoot;
    return (
      root?.querySelector<HTMLElement>(`[data-line='${CSS.escape(String(line))}']`) ?? undefined
    );
  }

  /**
   * The grammar to force, if any: one the `#!` line names when the file's name gives none
   * (ADR 0120), or plain text for a language beuve doesn't ship.
   */
  private languageOverride(library: typeof Diffs): LanguageOverride {
    if (Object.hasOwn(highlightedLanguages, library.getFiletypeFromFileName(this.path))) {
      return {};
    }
    const [firstLine] = this.contents.split('\n', 1);
    return { lang: languageFromShebang(firstLine?.trimEnd()) ?? 'text' };
  }

  override connectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.connectedCallback();
    void loadDiffsLibrary()
      .then((library) => {
        this.library = library;
        // Moved in the DOM, it was cleaned up when it left: render it again.
        this.requestUpdate();
      })
      .catch(() => {
        this.hasFailed = true;
      });
  }

  override disconnectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.disconnectedCallback();
    this.view?.cleanUp();
    this.view = undefined;
    this.diagnosticHighlights.clear();
    this.renderedKey = '';
  }

  /** Scrolls line `line` (1-based) into view, centred unless it is already visible, keeping the horizontal scroll. */
  async reveal(line: number): Promise<void> {
    const row = await waitFor(() => this.row(line));
    // scrollIntoView also scrolls sideways to fit a long line's end; only the rows move.
    const left = this.view?.getCodeScrollLeft();
    row?.scrollIntoView({ block: 'nearest' });
    const bounds = row?.getBoundingClientRect();
    if (row !== undefined && bounds !== undefined && !isInViewport(bounds)) {
      row.scrollIntoView({ block: 'center' });
    }
    if (left !== undefined) {
      this.view?.setCodeScrollLeft(left);
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has('diagnostics')) {
      this.syncDiagnostics();
    }
    const { library } = this;
    const container = this.renderRoot.querySelector<HTMLElement>('.code');
    if (library === undefined || container === null) {
      return;
    }
    this.view ??= this.createView(library);
    const key = `${this.cacheKey}\0${this.path}`;
    if (key !== this.renderedKey) {
      this.renderedKey = key;
      this.view.render({
        file: {
          name: this.path,
          contents: this.contents,
          cacheKey: key,
          ...this.languageOverride(library),
        },
        containerWrapper: container,
      });
    }
    if (this.compact) {
      return;
    }
    if (changed.has('selected') || changed.has('library') || changed.has('cacheKey')) {
      const { selected } = this;
      if (selected === undefined) {
        // eslint-disable-next-line unicorn/no-null -- the library clears the selection with null.
        this.view.setSelectedLines(null);
      } else {
        this.view.setSelectedLines({ start: selected.start, end: selected.end });
      }
    }
    void this.syncGutter();
  }

  override render(): TemplateResult {
    if (this.hasFailed || (this.compact && this.library === undefined)) {
      return html`<pre class="plain">${this.contents}</pre>`;
    }
    return html`<div class="code"></div>`;
  }
}

function isInViewport(bounds: DOMRect): boolean {
  return bounds.top >= 0 && bounds.bottom <= innerHeight;
}

/** Polls animation frames for something the library renders asynchronously. */
async function waitFor<T>(find: () => T | undefined): Promise<T | undefined> {
  for (let frame = 0; frame < 60; frame += 1) {
    const found = find();
    if (found !== undefined) {
      return found;
    }
    await new Promise((resolve) => {
      requestAnimationFrame(resolve);
    });
  }
  return undefined;
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-sheet-code': BeuveSheetCode;
  }
}

/** A file's `lang`, when the library's guess from its name is not the one to use. */
interface LanguageOverride {
  readonly lang?: string;
}
