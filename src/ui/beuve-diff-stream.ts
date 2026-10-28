import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type {
  AgentInsightView,
  ImpactView,
  InsightStatusView,
  ReviewView,
} from '#contract/ipc-contract.ts';

import './beuve-file-card.ts';
import { describeReviewScope } from './describe-review-scope.ts';
import { findFirstChangedLine } from './find-first-changed-line.ts';
import type { PeekState } from './peek-state.ts';
import { zoneStyles } from './zone-styles.ts';

/** A request to focus an insight from outside (a chat citation); `nonce` repeats a jump. */
export interface InsightJump {
  readonly insightId: string;
  readonly nonce: number;
}

/**
 * Zone 2: the diff stream. Shows the open session's review as file cards with a header naming the
 * review kind, ImpactGate banners and agent insights once they arrive. While the zone has focus,
 * `j`/`k` move between cards, `p` toggles the focused card's call-stack peek (Escape closes it),
 * `]`/`[` move between agent insights, and `y`/`d` promote or dismiss the focused one (again to
 * undo). Diff cards move to `@pierre/diffs` in Phase 2. Emits `beuve-mark-reviewed`,
 * `beuve-peek-request`, `beuve-peek-close` and `beuve-insight-status`; `beuve-app` does the IPC.
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

      .impact {
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      .impact.warning {
        color: var(--beuve-warn);
        font-weight: 600;
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
    if (event.key === 'p' || (event.key === 'Escape' && this.peek !== undefined)) {
      event.preventDefault();
      this.togglePeek(event.key === 'Escape');
      return;
    }
    const insightStep = { ']': 1, '[': -1 }[event.key];
    if (insightStep !== undefined) {
      event.preventDefault();
      this.stepInsight(insightStep);
      return;
    }
    if (event.key === 'y' || event.key === 'd') {
      event.preventDefault();
      this.toggleFocusedInsight(event.key === 'y' ? 'promoted' : 'dismissed');
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

  private readonly onInsightFocus = (event: CustomEvent<{ insightId: string }>): void => {
    this.focusInsight(event.detail.insightId);
  };

  @property({ type: Boolean, reflect: true }) accessor focused = false;

  /** What `session:list` said, shown while no session is open. */
  @property() accessor sessionNote = 'Loading sessions…';
  @property({ attribute: false }) accessor review: ReviewView | undefined;
  @property({ type: Boolean }) accessor loading = false;
  @property({ type: Boolean }) accessor marking = false;
  @property() accessor error = '';
  /** ImpactGate for `review`, once `session:get-impact` has answered. */
  @property({ attribute: false }) accessor impact: ImpactView | undefined;
  @property({ attribute: false }) accessor peek: PeekState | undefined;

  /** Agent insights for `review`'s head, every status. */
  @property({ attribute: false }) accessor insights: readonly AgentInsightView[] = [];
  @property({ attribute: false }) accessor insightJump: InsightJump | undefined;

  @state() accessor activeIndex = 0;
  @state() accessor focusedInsightId: string | undefined;

  constructor() {
    super();
    this.addEventListener('keydown', this.onKeyDown);
    this.addEventListener('beuve-insight-focus', this.onInsightFocus as EventListener);
  }

  /** The insights shown in the stream, in file order and then by line. */
  private orderedInsights(): AgentInsightView[] {
    const files = this.review?.files ?? [];
    return files.flatMap((file) =>
      this.insights
        .filter((insight) => insight.path === file.path)
        .toSorted((a, b) => a.lineStart - b.lineStart || a.lineEnd - b.lineEnd),
    );
  }

  private stepInsight(step: number): void {
    const ordered = this.orderedInsights();
    if (ordered.length === 0) {
      return;
    }
    const current = ordered.findIndex((insight) => insight.id === this.focusedInsightId);
    const next =
      current === -1
        ? this.firstInsightFromActiveFile(ordered, step)
        : Math.min(ordered.length - 1, Math.max(0, current + step));
    const target = ordered[next];
    if (target !== undefined) {
      this.focusInsight(target.id);
    }
  }

  private firstInsightFromActiveFile(ordered: readonly AgentInsightView[], step: number): number {
    const files = this.review?.files ?? [];
    const order = new Map(files.map((file, index) => [file.path, index]));
    const index =
      step > 0
        ? ordered.findIndex((insight) => (order.get(insight.path) ?? 0) >= this.activeIndex)
        : ordered.findLastIndex((insight) => (order.get(insight.path) ?? 0) <= this.activeIndex);
    return index === -1 ? (step > 0 ? ordered.length - 1 : 0) : index;
  }

  private focusInsight(insightId: string): void {
    const insight = this.insights.find((candidate) => candidate.id === insightId);
    const fileIndex = this.review?.files.findIndex((file) => file.path === insight?.path) ?? -1;
    if (insight === undefined || fileIndex === -1) {
      return;
    }
    this.focusedInsightId = insight.id;
    this.activeIndex = fileIndex;
    void this.revealInsight(fileIndex, insight.id);
  }

  private async revealInsight(fileIndex: number, insightId: string): Promise<void> {
    await this.updateComplete;
    await this.renderRoot.querySelectorAll('beuve-file-card')[fileIndex]?.revealInsight(insightId);
  }

  private toggleFocusedInsight(status: Exclude<InsightStatusView, 'pending'>): void {
    const insight = this.insights.find((candidate) => candidate.id === this.focusedInsightId);
    if (insight === undefined) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent('beuve-insight-status', {
        detail: { insightId: insight.id, status: insight.status === status ? 'pending' : status },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private togglePeek(isClosing: boolean): void {
    const file = this.review?.files[this.activeIndex];
    if (isClosing || file === undefined || this.peek?.path === file.path) {
      this.dispatchEvent(new CustomEvent('beuve-peek-close', { bubbles: true, composed: true }));
      return;
    }
    this.dispatchEvent(
      new CustomEvent('beuve-peek-request', {
        detail: { path: file.path, line: findFirstChangedLine(file.patch) },
        bubbles: true,
        composed: true,
      }),
    );
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
        ${this.renderImpactTotals()}
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
                      .impact=${this.impact?.files.find((entry) => entry.path === file.path)}
                      .findings=${this.impact?.findings ?? []}
                      .peek=${this.peek?.path === file.path ? this.peek : undefined}
                      .insights=${this.insights.filter((insight) => insight.path === file.path)}
                      .focusedInsightId=${this.focusedInsightId}
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

  private renderImpactTotals(): TemplateResult | typeof nothing {
    const { impact } = this;
    if (impact === undefined || impact.headSha !== this.review?.headSha) {
      return nothing;
    }
    const count = impact.totals.findings;
    return html`<span
      class="impact ${count > 0 ? 'warning' : ''}"
      title="ImpactGate computed in ${String(impact.computeMs)} ms"
      >ImpactGate:
      ${count === 0 ? 'no findings' : `${String(count)} ${count === 1 ? 'finding' : 'findings'}`}</span
    >`;
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
    if (!changed.has('review') && !changed.has('insights')) {
      return;
    }
    const isShown = this.insights.some((insight) => insight.id === this.focusedInsightId);
    this.focusedInsightId = isShown ? this.focusedInsightId : undefined;
  }

  protected override updated(changed: PropertyValues<this>): void {
    const jump = this.insightJump;
    if (jump !== undefined && changed.has('insightJump')) {
      this.focusInsight(jump.insightId);
      return;
    }
    if (changed.has('activeIndex') && !changed.has('review') && !changed.has('focusedInsightId')) {
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
