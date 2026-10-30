import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';

import { ActionDelegation } from './action-delegation.ts';
import { palettePrefixes } from './palette-prefixes.ts';
import type { PaletteGroup } from './palette-prefixes.ts';
import { planPalette } from './plan-palette.ts';
import type { PaletteEntry, PaletteSources } from './plan-palette.ts';

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
  static override styles = css`
    :host {
      position: fixed;
      inset: 0;
      z-index: 20;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding-top: 12vh;
      background: var(--beuve-scrim-soft);
    }

    .panel {
      display: flex;
      flex-direction: column;
      width: min(640px, calc(100vw - 48px));
      max-height: 70vh;
      overflow: hidden;
      border: 1px solid var(--beuve-border);
      border-radius: 10px;
      background: var(--beuve-surface);
      box-shadow: 0 16px 48px #00000040;
    }

    input {
      flex: none;
      padding: var(--beuve-space-3) var(--beuve-space-4);
      border: none;
      border-bottom: 1px solid var(--beuve-border);
      background: none;
      color: var(--beuve-text);
      font: inherit;
      font-size: 15px;
      outline: none;
    }

    ol {
      flex: 1;
      min-height: 0;
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
      max-width: 70%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .title.path {
      font: var(--beuve-font-mono);
    }

    b {
      font-weight: 600;
      color: var(--beuve-accent);
    }

    .detail {
      flex: 1;
      min-width: 0;
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

    kbd {
      padding: 0 5px;
      border: 1px solid var(--beuve-border);
      border-radius: 4px;
      background: var(--beuve-surface-sunken);
      font: var(--beuve-font-mono);
      font-size: 11px;
      color: var(--beuve-text-muted);
    }

    .empty {
      margin: 0;
      padding: var(--beuve-space-4);
      color: var(--beuve-text-muted);
    }

    footer {
      flex: none;
      display: flex;
      flex-wrap: wrap;
      gap: var(--beuve-space-1) var(--beuve-space-4);
      padding: var(--beuve-space-2) var(--beuve-space-4);
      border-top: 1px solid var(--beuve-border);
      font: var(--beuve-font-small);
      color: var(--beuve-text-muted);
    }

    footer button {
      padding: 0;
      border: none;
      background: none;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }

    footer code {
      font: var(--beuve-font-mono);
      font-size: 11px;
      color: var(--beuve-text);
    }

    .spacer {
      flex: 1;
    }
  `;

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
      this.cursor = (this.cursor + (isNext ? 1 : -1) + count) % count;
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
    if (event.target === this) {
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
      <span class="title ${isPath ? 'path' : ''}">${highlight(entry)}</span>
      <span class="detail">${entry.detail ?? ''}</span>
      ${
        entry.keys === undefined || entry.keys.length === 0
          ? nothing
          : html`<span class="keys">${entry.keys.map((key) => html`<kbd>${key}</kbd>`)}</span>`
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
                  const label =
                    isNarrowed || entry.group === previous
                      ? nothing
                      : html`<li class="group" role="presentation">
                          ${groupLabels[entry.group]}
                        </li>`;
                  previous = entry.group;
                  return html`${label}${this.renderEntry(entry, index)}`;
                })}
              </ol>`
        }
        <footer>
          ${Object.entries(palettePrefixes).map(
            ([key, group]) =>
              html`<button type="button" data-action="prefix" data-prefix=${key}>
                <code>${key}</code> ${groupLabels[group].toLowerCase()}
              </button>`,
          )}
        </footer>
      </div>
    `;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('initialText')) {
      this.text = this.initialText;
      this.cursor = 0;
    }
    this.entries = this.sources === undefined ? [] : planPalette(this.text, this.sources);
    this.cursor = Math.max(0, Math.min(this.cursor, this.entries.length - 1));
  }
}

/** The title with matched characters in bold. */
function highlight(entry: PaletteEntry): TemplateResult {
  if (entry.matches.length === 0) {
    return html`${entry.title}`;
  }
  const marked = new Set(entry.matches);
  return html`${Array.from(entry.title, (character, index) =>
    marked.has(index) ? html`<b>${character}</b>` : character,
  )}`;
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-command-palette': BeuveCommandPalette;
  }
}
