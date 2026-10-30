import { css, html, LitElement } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

const stepKeys: ReadonlySet<string> = new Set(['Enter', 'F3', 'ArrowDown', 'ArrowUp']);

/** What the reviewer typed into the find bar. */
export interface FindQueryDetail {
  readonly query: string;
  readonly isCaseSensitive: boolean;
}

/**
 * The "Find in review" bar (⌘F / Ctrl+F, ADR 0051) above the diff stream: a query, the hit count
 * and arrows. Enter and Shift+Enter (or F3, ↓/↑) step through the hits, Alt+C toggles case and
 * Escape closes. Keys typed here never reach the stream's shortcuts. Emits `beuve-find-query`,
 * `beuve-find-step` (`{ step: 1 | -1 }`) and `beuve-find-close`; the stream searches the review
 * data and reveals each hit.
 */
@customElement('beuve-find-bar')
export class BeuveFindBar extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      align-items: center;
      gap: var(--beuve-space-2);
      padding: var(--beuve-space-1) var(--beuve-space-3);
      border-bottom: 1px solid var(--beuve-border);
      background: var(--beuve-surface);
      font: var(--beuve-font-small);
    }

    input {
      flex: 0 1 320px;
      min-width: 120px;
      padding: 2px var(--beuve-space-2);
      border: 1px solid var(--beuve-border);
      border-radius: 4px;
      background: var(--beuve-bg);
      color: var(--beuve-text);
      font: var(--beuve-font-mono);
    }

    input:focus {
      border-color: var(--beuve-accent);
      outline: none;
    }

    .count {
      min-width: 7em;
      color: var(--beuve-text-muted);
      font-variant-numeric: tabular-nums;
    }

    .count.none {
      color: var(--beuve-danger);
    }

    button {
      padding: 0 var(--beuve-space-2);
      border: 1px solid var(--beuve-border);
      border-radius: 4px;
      background: var(--beuve-surface);
      color: var(--beuve-text);
      font: inherit;
      cursor: pointer;
    }

    button[aria-pressed='true'] {
      border-color: var(--beuve-accent);
      color: var(--beuve-accent);
    }

    .hint {
      flex: 1;
      text-align: right;
      color: var(--beuve-text-muted);
    }
  `;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      this.emit('beuve-find-close');
      return;
    }
    if (stepKeys.has(event.key)) {
      event.preventDefault();
      const isBack = event.shiftKey || event.key === 'ArrowUp';
      this.emit('beuve-find-step', { step: isBack ? -1 : 1 });
      return;
    }
    if (!event.altKey || event.code !== 'KeyC') {
      return;
    }
    event.preventDefault();
    this.emitQuery(this.query, !this.isCaseSensitive);
  };

  @property() accessor query = '';
  @property({ type: Boolean }) accessor isCaseSensitive = false;
  /** Hits found, the one shown (0-based, -1 for none yet), and whether the search stopped early. */
  @property({ type: Number }) accessor count = 0;
  @property({ type: Number }) accessor current = -1;
  @property({ type: Boolean }) accessor isCapped = false;

  private emit(name: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private emitQuery(query: string, isCaseSensitive: boolean): void {
    const detail: FindQueryDetail = { query, isCaseSensitive };
    this.emit('beuve-find-query', detail);
  }

  private describeCount(): string {
    if (this.query === '') {
      return '';
    }
    if (this.count === 0) {
      return 'No results';
    }
    const total = `${String(this.count)}${this.isCapped ? '+' : ''}`;
    return this.current === -1 ? `${total} found` : `${String(this.current + 1)} of ${total}`;
  }

  /** Focuses the query and selects it, so typing replaces it. */
  focusInput(): void {
    const input = this.renderRoot.querySelector('input');
    input?.focus();
    input?.select();
  }

  override render(): TemplateResult {
    const label = this.describeCount();
    return html`<input
        type="search"
        aria-label="Find in review"
        placeholder="Find in review"
        spellcheck="false"
        .value=${this.query}
        @input=${(event: Event): void => {
          this.emitQuery((event.target as HTMLInputElement).value, this.isCaseSensitive);
        }}
        @keydown=${this.onKeyDown}
      />
      <span class="count ${this.query !== '' && this.count === 0 ? 'none' : ''}" role="status"
        >${label}</span
      >
      <button
        type="button"
        title="Previous (Shift+Enter)"
        aria-label="Previous match"
        @click=${(): void => {
          this.emit('beuve-find-step', { step: -1 });
        }}
      >
        ↑
      </button>
      <button
        type="button"
        title="Next (Enter)"
        aria-label="Next match"
        @click=${(): void => {
          this.emit('beuve-find-step', { step: 1 });
        }}
      >
        ↓
      </button>
      <button
        type="button"
        title="Match case (Alt+C)"
        aria-pressed=${this.isCaseSensitive ? 'true' : 'false'}
        @click=${(): void => {
          this.emitQuery(this.query, !this.isCaseSensitive);
        }}
      >
        Aa
      </button>
      <span class="hint">Searches every file’s diff, collapsed ones too · Esc closes</span>
      <button
        type="button"
        aria-label="Close find"
        title="Close (Esc)"
        @click=${(): void => {
          this.emit('beuve-find-close');
        }}
      >
        ×
      </button>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-find-bar': BeuveFindBar;
  }
}
