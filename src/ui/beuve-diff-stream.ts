import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type { ReviewView } from '#contract/ipc-contract.ts';

import './beuve-file-card.ts';
import { describeReviewScope } from './describe-review-scope.ts';
import { zoneStyles } from './zone-styles.ts';

/**
 * Zone 2: the diff stream. Shows the open session's review as file cards with a header naming the
 * review kind; `j`/`k` move between cards while the zone has focus. Diff cards move to
 * `@pierre/diffs` in Phase 2. Emits `beuve-mark-reviewed`; `beuve-app` does the IPC.
 */
@customElement('beuve-diff-stream')
export class BeuveDiffStream extends LitElement {
  static override styles = [
    zoneStyles,
    css`
      :host {
        background: var(--beuve-bg);
      }

      .welcome {
        display: grid;
        height: 100%;
        place-items: center;
      }

      .welcome > div {
        max-width: 420px;
        text-align: center;
      }

      .welcome h1 {
        margin: 0 0 var(--beuve-space-2);
        font-size: 20px;
        font-weight: 600;
      }

      .welcome p {
        margin: 0 0 var(--beuve-space-3);
        color: var(--beuve-text-muted);
      }

      .note {
        display: inline-block;
        padding: var(--beuve-space-1) var(--beuve-space-3);
        border: 1px solid var(--beuve-border);
        border-radius: var(--beuve-radius);
        background: var(--beuve-surface);
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      .note.error {
        color: var(--beuve-danger);
      }

      .summary {
        display: flex;
        align-items: center;
        gap: var(--beuve-space-3);
        flex: none;
        padding: var(--beuve-space-2) var(--beuve-space-3);
        border-bottom: 1px solid var(--beuve-border);
        background: var(--beuve-surface);
      }

      .scope {
        font-weight: 600;
      }

      .scope.interdiff {
        color: var(--beuve-insight);
      }

      .range,
      .counts {
        font: var(--beuve-font-mono);
        color: var(--beuve-text-muted);
      }

      .spacer {
        flex: 1;
      }

      button {
        padding: var(--beuve-space-1) var(--beuve-space-3);
        border: 1px solid var(--beuve-accent);
        border-radius: var(--beuve-radius);
        background: var(--beuve-accent);
        color: #fff;
        font: inherit;
        cursor: pointer;
      }

      button:disabled {
        border-color: var(--beuve-border);
        background: var(--beuve-surface-sunken);
        color: var(--beuve-text-muted);
        cursor: default;
      }

      .cards {
        display: flex;
        flex-direction: column;
        gap: var(--beuve-space-3);
      }
    `,
  ];

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) {
      return;
    }
    const step = { j: 1, k: -1 }[event.key];
    const count = this.review?.files.length ?? 0;
    if (step === undefined || count === 0) {
      return;
    }
    event.preventDefault();
    this.activeIndex = Math.min(count - 1, Math.max(0, this.activeIndex + step));
  };

  private readonly onMarkClick = (): void => {
    this.dispatchEvent(new CustomEvent('beuve-mark-reviewed', { bubbles: true, composed: true }));
  };

  @property({ type: Boolean, reflect: true }) accessor focused = false;

  /** What `session:list` said, shown while no session is open. */
  @property() accessor sessionNote = 'Loading sessions…';
  @property({ attribute: false }) accessor review: ReviewView | undefined;
  @property({ type: Boolean }) accessor loading = false;
  @property({ type: Boolean }) accessor marking = false;
  @property() accessor error = '';

  @state() accessor activeIndex = 0;

  constructor() {
    super();
    this.addEventListener('keydown', this.onKeyDown);
  }

  private renderWelcome(): TemplateResult {
    const note = this.loading ? 'Loading review…' : this.error || this.sessionNote;
    return html`
      <div class="body welcome">
        <div>
          <h1>No review session open</h1>
          <p>Open a local repository or pick a session in the Intent sidebar.</p>
          <span class="note ${this.error === '' ? '' : 'error'}">${note}</span>
        </div>
      </div>
    `;
  }

  private renderReview(review: ReviewView): TemplateResult {
    const additions = review.files.reduce((sum, file) => sum + file.additions, 0);
    const deletions = review.files.reduce((sum, file) => sum + file.deletions, 0);
    const isUpToDate = review.scope.kind === 'up-to-date';
    return html`
      <div class="summary">
        <span class="scope ${review.scope.kind}">${describeReviewScope(review.scope)}</span>
        <span class="range" title=${rangeTitle(review)}>${rangeLabel(review)}</span>
        <span class="counts"
          >${review.files.length} ${review.files.length === 1 ? 'file' : 'files'} +${additions}
          −${deletions}</span
        >
        <span class="spacer"></span>
        ${this.error === '' ? nothing : html`<span class="note error">${this.error}</span>`}
        <button
          type="button"
          ?disabled=${isUpToDate || this.marking || this.loading}
          @click=${this.onMarkClick}
        >
          ${this.marking ? 'Marking…' : 'Mark reviewed'}
        </button>
      </div>
      <div class="body">
        ${
          isUpToDate
            ? html`<p class="empty">Everything up to the head has been reviewed.</p>`
            : html`<div class="cards">
                ${review.files.map(
                  (file, index) =>
                    html`<beuve-file-card
                      .file=${file}
                      ?active=${index === this.activeIndex}
                      @click=${(): void => {
                        this.activeIndex = index;
                      }}
                    ></beuve-file-card>`,
                )}
              </div>`
        }
      </div>
    `;
  }

  override render(): TemplateResult {
    return html`
      <header>Diff stream</header>
      ${this.review === undefined ? this.renderWelcome() : this.renderReview(this.review)}
    `;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('review')) {
      this.activeIndex = 0;
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has('activeIndex') && !changed.has('review')) {
      this.renderRoot
        .querySelectorAll('beuve-file-card')
        [this.activeIndex]?.scrollIntoView({ block: 'start' });
    }
  }
}

/** Short shas of what the diff spans: fork point to head, or last reviewed head to head. */
function rangeLabel(review: ReviewView): string {
  const from = review.scope.kind === 'interdiff' ? review.scope.fromHeadSha : review.baseSha;
  return `${from.slice(0, 8)}..${review.headSha.slice(0, 8)}`;
}

function rangeTitle(review: ReviewView): string {
  return review.scope.kind === 'interdiff'
    ? `Changes since reviewed head ${review.scope.fromHeadSha}, now at ${review.headSha} (forked from ${review.baseSha})`
    : `${review.baseSha}..${review.headSha}`;
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-diff-stream': BeuveDiffStream;
  }
}
