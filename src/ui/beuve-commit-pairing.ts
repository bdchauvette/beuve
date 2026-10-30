import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type { CommitPairView } from '#contract/ipc-contract.ts';

import { describeCommitPair } from './describe-commit-pair.ts';
import type { CommitPairRow } from './describe-commit-pair.ts';
import { moveCommitPairCursor } from './move-commit-pair-cursor.ts';

/** Detail of `beuve-commit-pair-filter`: the pair to filter the diff stream to, or none. */
export interface CommitPairFilterDetail {
  readonly pairId: string | undefined;
}

/**
 * The commits of an interdiff paired across a rebase (ADR 0054): previous → new sha, a kind chip,
 * the subject and the new commit's +/−. One tab stop; `j`/`k`, the arrows, `Home` and `End` move
 * the cursor, `Enter` or `Space` filters the diff stream to the pair under it (again clears it),
 * `Escape` clears. Each change emits a bubbling, composed `beuve-commit-pair-filter` event with a
 * {@link CommitPairFilterDetail}; the owner sets `selectedId` from it.
 */
@customElement('beuve-commit-pairing')
export class BeuveCommitPairing extends LitElement {
  static override styles = css`
    :host {
      display: block;
      font: var(--beuve-font-body);
      color: var(--beuve-text);
    }

    header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--beuve-space-2);
      padding: 0 var(--beuve-space-2) var(--beuve-space-1);
      font: var(--beuve-font-small);
      color: var(--beuve-text-muted);
    }

    header button {
      padding: 0;
      border: 0;
      background: none;
      font: inherit;
      color: var(--beuve-accent);
      cursor: pointer;
    }

    ol {
      margin: 0;
      padding: 0;
      list-style: none;
      border-radius: var(--beuve-radius);
      outline: none;
    }

    ol:focus-visible {
      box-shadow: 0 0 0 2px var(--beuve-accent-soft);
    }

    li {
      display: grid;
      grid-template-columns: auto auto minmax(0, 1fr) auto;
      align-items: baseline;
      gap: var(--beuve-space-2);
      padding: 3px var(--beuve-space-2);
      border-radius: 4px;
      cursor: pointer;
    }

    li:hover {
      background: var(--beuve-surface-sunken);
    }

    li.cursor {
      box-shadow: inset 2px 0 0 var(--beuve-accent);
    }

    li[aria-selected='true'] {
      background: var(--beuve-accent-soft);
    }

    li.dropped {
      cursor: default;
    }

    li.dropped .subject {
      color: var(--beuve-text-muted);
      text-decoration: line-through;
    }

    .commits,
    .stats {
      font: var(--beuve-font-mono);
      font-size: 11px;
      color: var(--beuve-text-muted);
      white-space: nowrap;
    }

    .chip {
      padding: 0 6px;
      border: 1px solid var(--beuve-border);
      border-radius: 999px;
      font: var(--beuve-font-small);
      color: var(--beuve-text-muted);
    }

    .modified .chip {
      border-color: var(--beuve-warn);
      color: var(--beuve-warn);
    }

    .added .chip {
      border-color: var(--beuve-ok);
      color: var(--beuve-ok);
    }

    .dropped .chip {
      border-color: var(--beuve-danger);
      color: var(--beuve-danger);
    }

    .subject {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .empty {
      padding: 0 var(--beuve-space-2);
      font: var(--beuve-font-small);
      color: var(--beuve-text-muted);
    }
  `;

  @state() private accessor cursor = 0;

  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const moved = moveCommitPairCursor(this.cursor, this.pairs.length, event.key);
    if (moved !== undefined) {
      event.preventDefault();
      this.cursor = moved;
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      const pair = this.pairs[this.clampedCursor(this.pairs.length)];
      if (pair !== undefined) {
        event.preventDefault();
        this.toggle(describeCommitPair(pair));
      }
      return;
    }
    if (event.key !== 'Escape' || this.selectedId === undefined) {
      return;
    }
    event.preventDefault();
    this.clear();
  };

  private readonly clear = (): void => {
    this.emit(undefined);
  };

  /** The review's `commitPairs`. */
  @property({ attribute: false }) accessor pairs: readonly CommitPairView[] = [];
  /** The pair the diff stream is filtered to, if any. */
  @property({ attribute: false }) accessor selectedId: string | undefined = undefined;

  private renderRow(row: CommitPairRow, index: number): TemplateResult {
    const isCursor = index === this.clampedCursor(this.pairs.length);
    return html`
      <li
        id=${`pair-${String(index)}`}
        role="option"
        class="${row.kind}${isCursor ? ' cursor' : ''}"
        aria-selected=${row.id === this.selectedId ? 'true' : 'false'}
        aria-disabled=${row.isFilterable ? 'false' : 'true'}
        title=${row.title}
        @click=${(): void => {
          this.cursor = index;
          this.toggle(row);
        }}
      >
        <span class="commits">${row.commits}</span>
        <span class="chip">${row.chip}</span>
        <span class="subject">${row.subject}</span>
        <span class="stats">${row.stats}</span>
      </li>
    `;
  }

  private clampedCursor(count: number): number {
    return Math.min(Math.max(this.cursor, 0), Math.max(count - 1, 0));
  }

  private toggle(row: CommitPairRow): void {
    if (!row.isFilterable) {
      return;
    }
    this.emit(row.id === this.selectedId ? undefined : row.id);
  }

  private emit(pairId: string | undefined): void {
    const detail: CommitPairFilterDetail = { pairId };
    this.dispatchEvent(
      new CustomEvent('beuve-commit-pair-filter', { detail, bubbles: true, composed: true }),
    );
  }

  override render(): TemplateResult {
    const rows = this.pairs.map((pair) => describeCommitPair(pair));
    const changed = rows.filter((row) => row.kind !== 'unchanged').length;
    return html`
      <header>
        <span>
          ${rows.length} ${rows.length === 1 ? 'commit' : 'commits'}
          ${changed === 0 ? '· none changed' : `· ${String(changed)} changed`}
        </span>
        ${
          this.selectedId === undefined
            ? nothing
            : html`<button type="button" @click=${this.clear}>Show all</button>`
        }
      </header>
      ${
        rows.length === 0
          ? html`<p class="empty">No commits to pair.</p>`
          : html`<ol
              role="listbox"
              aria-label="Commits since the last review"
              tabindex="0"
              aria-activedescendant=${`pair-${String(this.clampedCursor(rows.length))}`}
              @keydown=${this.onKeydown}
            >
              ${rows.map((row, index) => this.renderRow(row, index))}
            </ol>`
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-commit-pairing': BeuveCommitPairing;
  }
}
