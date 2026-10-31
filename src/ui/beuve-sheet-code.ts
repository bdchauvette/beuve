import type * as Diffs from '@pierre/diffs';
import type { File, OnTokenEventProps, SelectedLineRange } from '@pierre/diffs';
import { css, html, LitElement } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type { SheetMarksView, SheetNoteView } from '#contract/ipc-contract.ts';

import { highlightedLanguages } from './highlighted-languages.ts';
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

/** Lines the reviewer selected with the mouse, 1-based and inclusive. */
export interface SheetSelectDetail {
  readonly start: number;
  readonly end: number;
}

/**
 * The code of a sheet (ADR 0067): a whole file through `@pierre/diffs`' `File`, highlighted with
 * beuve's Alabaster themes (ADR 0025), line numbers on, read-only. The gutter shows the change's
 * marks, staged notes and find hits (`sheetGutterCssFrom`); `selected` is the line cursor or the
 * jump's range. Emits `beuve-sheet-token` for a clicked token and `beuve-sheet-select` for
 * lines selected by mouse. The library is a lazy chunk, as in the diff cards. `compact` is a
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
      --diffs-font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
      --diffs-font-size: 12.5px;
      --diffs-line-height: 21px;
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
      font: var(--beuve-font-mono);
      white-space: pre;
      color: var(--beuve-code-text);
    }
  `;

  private view: File | undefined;
  private sheet: CSSStyleSheet | undefined;
  private renderedKey = '';

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
          character: props.lineCharStart,
          isJump: event.metaKey || event.ctrlKey,
        };
        this.dispatchEvent(new CustomEvent('beuve-sheet-token', { detail, bubbles: true }));
      },
      onPostRender: (): void => {
        void this.syncGutter();
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

  private row(line: number): HTMLElement | undefined {
    const root = this.renderRoot.querySelector('diffs-container')?.shadowRoot;
    return (
      root?.querySelector<HTMLElement>(`[data-line='${CSS.escape(String(line))}']`) ?? undefined
    );
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
    this.renderedKey = '';
  }

  /** Scrolls line `line` (1-based) into view, centred unless it is already visible. */
  async reveal(line: number): Promise<void> {
    const row = await waitFor(() => this.row(line));
    row?.scrollIntoView({ block: 'nearest' });
    const bounds = row?.getBoundingClientRect();
    if (row !== undefined && bounds !== undefined && !isInViewport(bounds)) {
      row.scrollIntoView({ block: 'center' });
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
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
          ...(!Object.hasOwn(highlightedLanguages, library.getFiletypeFromFileName(this.path)) && {
            lang: 'text',
          }),
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
