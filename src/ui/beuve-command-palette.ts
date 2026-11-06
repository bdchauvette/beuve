import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';

import { ActionDelegation } from './action-delegation.ts';
import { isOwnClick } from './is-own-click.ts';
import { palettePrefixes } from './palette-prefixes.ts';
import type { PaletteGroup } from './palette-prefixes.ts';
import { planPalette } from './plan-palette.ts';
import type { PaletteEntry, PaletteSources } from './plan-palette.ts';
import { formatControlStyles } from './format-control-styles.ts';
import { pathText } from './path-text.ts';
import { buttonStyles } from './primitives/button-styles.ts';
import { kbdStyles } from './primitives/kbd-styles.ts';
import { emptyStateStyles } from './primitives/empty-state-styles.ts';

const leadingPrefix = /^\s*[>@#!]/u;

const groupLabels: Readonly<Record<PaletteGroup, string>> = {
  open: 'Open',
  files: 'Files',
  review: 'Review',
  commands: 'Commands',
};

const placeholders: Readonly<Record<string, string>> = {
  '': 'Search commands, files, reviews and notes',
  '>': 'Run a command',
  '@': 'Go to a file in this review',
  '#': 'Open a recent review, or paste a pull request link or folder',
  '!': 'Find a staged note',
};

/**
 * The command palette (⌘K, ⌘⇧P; ⌘P starts in files). One input over every command in the
 * registry with its shortcut, recent sessions and open actions, the review's files and its
 * staged notes; `>`, `@`, `#` and `!` narrow it to one group (`planPalette`). Arrow
 * keys or Ctrl+N/P move, Enter runs, Escape closes. Emits `beuve-palette-run { action }` and
 * `beuve-palette-close`; `beuve-app` runs the action.
 */
@customElement('beuve-command-palette')
export class BeuveCommandPalette extends LitElement {
  static override styles = [
    emptyStateStyles,
    kbdStyles,
    buttonStyles,
    formatControlStyles,
    css`
      :host {
        position: fixed;
        inset: 0;
        z-index: 20;
        display: flex;
        justify-content: center;
        align-items: flex-start;
        padding-block-start: 12vh;
        background: var(--beuve-scrim-soft);
      }

      .panel {
        display: flex;
        flex-direction: column;
        inline-size: min(640px, calc(100vw - 48px));
        max-block-size: 70vh;
        overflow: hidden;
        border: 1px solid var(--beuve-border);
        border-radius: 10px;
        background: var(--beuve-surface);
        box-shadow: var(--beuve-shadow-large);
      }

      input {
        flex: none;
        padding: var(--beuve-space-3) var(--beuve-space-4);
        border: none;
        border-block-end: 1px solid var(--beuve-border);
        background: none;
        color: var(--beuve-text);
        font: inherit;
        font-size: var(--beuve-font-size-large);
        outline: none;
      }

      ol {
        flex: 1;
        min-block-size: 0;
        margin: 0;
        padding: var(--beuve-space-1) 0;
        overflow: auto;
        list-style: none;
      }

      .group {
        padding: var(--beuve-space-2) var(--beuve-space-4) 2px;
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      .entry {
        display: flex;
        align-items: baseline;
        gap: var(--beuve-space-3);
        margin: 0 var(--beuve-space-1);
        padding: 5px var(--beuve-space-3);
        border-radius: var(--beuve-radius);
        cursor: pointer;
      }

      .entry[aria-selected='true'] {
        background: var(--beuve-accent-soft);
      }

      .title {
        flex: none;
        max-inline-size: 70%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .title.path {
        font: var(--beuve-font-mono);
      }

      b {
        font-weight: var(--beuve-font-weight-semibold);
        color: var(--beuve-accent);
      }

      .detail {
        flex: 1;
        min-inline-size: 0;
        overflow: hidden;
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .keys {
        flex: none;
        display: flex;
        gap: var(--beuve-space-1);
      }

      .empty {
        padding: var(--beuve-space-4);
      }

      footer {
        flex: none;
        display: flex;
        flex-wrap: wrap;
        gap: var(--beuve-space-1) var(--beuve-space-4);
        padding: var(--beuve-space-2) var(--beuve-space-4);
        border-block-start: 1px solid var(--beuve-border);
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      footer code {
        font: var(--beuve-font-mono);
        font-size: var(--beuve-font-size-caption);
        color: var(--beuve-text);
      }

      .spacer {
        flex: 1;
      }
    `,
  ];

  private entries: PaletteEntry[] = [];

  private readonly onInput = (event: InputEvent): void => {
    this.text = (event.currentTarget as HTMLInputElement).value;
    this.cursor = 0;
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    event.stopPropagation();
    const isNext = event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'n');
    const isPrevious = event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'p');
    const count = this.entries.length;
    if ((isNext || isPrevious) && count > 0) {
      event.preventDefault();
      let step = -1;
      if (isNext) {
        step = 1;
      }
      this.cursor = (this.cursor + step + count) % count;
      this.scrollCursorIntoView();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const entry = this.entries[this.cursor];
      if (entry !== undefined) {
        this.run(entry);
      }
      return;
    }
    if (event.key !== 'Escape') {
      return;
    }

    event.preventDefault();
    this.emit('beuve-palette-close', {});
  };

  private readonly onScrimClick = (event: MouseEvent): void => {
    if (isOwnClick(event, this)) {
      this.emit('beuve-palette-close', {});
    }
  };

  @property({ attribute: false }) accessor sources: PaletteSources | undefined;
  /** `process.platform`, for writing shortcuts the platform's way. */
  @property() accessor platform = '';
  /** The input's starting text, e.g. `@` for ⌘P. */
  @property() accessor initialText = '';

  @state() accessor text = '';
  @state() accessor cursor = 0;

  constructor() {
    super();
    this.addEventListener('click', this.onScrimClick);
    // ADR 0074: the entries and prefix buttons, through one listener per type.
    this.addController(
      new ActionDelegation(this, {
        click: {
          entry: ({ index }): void => {
            const entry = this.entries[Number(index)];
            if (entry !== undefined) {
              this.run(entry);
            }
          },
          prefix: ({ prefix = '' }): void => {
            this.setPrefix(prefix);
          },
        },
        mousemove: {
          entry: ({ index }): void => {
            this.cursor = Number(index);
          },
        },
      }),
    );
  }

  private run(entry: PaletteEntry): void {
    this.emit('beuve-palette-run', { action: entry.action });
  }

  private setPrefix(prefix: string): void {
    const body = this.text.replace(leadingPrefix, '');
    this.text = `${prefix}${body}`;
    this.cursor = 0;
    this.focus();
  }

  private emit(name: string, detail: object): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private scrollCursorIntoView(): void {
    void this.updateComplete.then(() => {
      this.renderRoot.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    });
  }

  private renderEntry(entry: PaletteEntry, index: number): TemplateResult {
    const isPath = entry.group === 'files';
    return html`<li
      class="entry"
      role="option"
      aria-selected=${index === this.cursor ? 'true' : 'false'}
      data-action="entry"
      data-index=${index}
    >
      <span class="title ${isPath ? 'path' : ''}" title=${isPath ? entry.title : nothing}
        >${highlight(entry)}</span
      >
      <span class="detail">${entry.detail ?? ''}</span>
      ${
        entry.keys === undefined || entry.keys.length === 0
          ? nothing
          : html`<span class="keys"
              >${entry.keys.map((key) => {
                return html`<kbd>${key}</kbd>`;
              })}</span
            >`
      }
    </li>`;
  }

  /** The highlighted entry's action, for Add to Chat on a file or a staged note (ADR 0046). */
  activeAction(): PaletteEntry['action'] | undefined {
    return this.entries[this.cursor]?.action;
  }

  override focus(): void {
    void this.updateComplete.then(() => {
      const input = this.renderRoot.querySelector('input');
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    });
  }

  override render(): TemplateResult {
    const prefix = this.text.trimStart().charAt(0);
    const isNarrowed = palettePrefixes[prefix] !== undefined;
    let previous: PaletteGroup | undefined;
    return html`
      <div class="panel" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          aria-label="Command palette"
          placeholder=${placeholders[isNarrowed ? prefix : ''] ?? ''}
          autocomplete="off"
          spellcheck="false"
          .value=${live(this.text)}
          @input=${this.onInput}
          @keydown=${this.onKeyDown}
        />
        ${
          this.entries.length === 0
            ? html`<p class="empty">Nothing matches.</p>`
            : html`<ol role="listbox">
                ${this.entries.map((entry, index) => {
                  const isNewGroup = !isNarrowed && entry.group !== previous;
                  previous = entry.group;
                  return html`${
                    isNewGroup
                      ? html`<li class="group" role="presentation">${groupLabels[entry.group]}</li>`
                      : nothing
                  }${this.renderEntry(entry, index)}`;
                })}
              </ol>`
        }
        <footer>
          ${Object.entries(palettePrefixes).map(([key, group]) => {
            return html`<button
              class="button quiet"
              type="button"
              data-action="prefix"
              data-prefix=${key}
            >
              <code>${key}</code> ${groupLabels[group].toLowerCase()}
            </button>`;
          })}
        </footer>
      </div>
    `;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('initialText')) {
      this.text = this.initialText;
      this.cursor = 0;
    }
    this.entries = [];
    if (this.sources !== undefined) {
      this.entries = planPalette(this.text, this.sources);
    }
    this.cursor = Math.max(0, Math.min(this.cursor, this.entries.length - 1));
  }
}

/** The title with matched characters in bold. */
/**
 * The entry's title with its matched characters in bold. A file's path shows its invisible and
 * bidi characters as escapes (ADR 0082), one per character so the match indexes still line up.
 */
function highlight(entry: PaletteEntry): TemplateResult {
  const show = (text: string): TemplateResult | string => {
    if (entry.group === 'files') {
      return pathText(text);
    }
    return text;
  };
  if (entry.matches.length === 0) {
    return html`${show(entry.title)}`;
  }
  const marked = new Set(entry.matches);
  return html`${Array.from(entry.title, (character, index) => {
    if (marked.has(index)) {
      return html`<b>${show(character)}</b>`;
    }
    return show(character);
  })}`;
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-command-palette': BeuveCommandPalette;
  }
}
