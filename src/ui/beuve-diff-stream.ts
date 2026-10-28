import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

import type {
  AgentInsightView,
  ImpactView,
  InsightStatusView,
  ReviewView,
  UraAnchorView,
  UraItemView,
} from '#contract/ipc-contract.ts';

import './beuve-file-card.ts';
import type { BeuveFileCard, ComposerState, FilePairLoader } from './beuve-file-card.ts';
import type { UraDraft } from './beuve-ura-composer.ts';
import { describeReviewScope } from './describe-review-scope.ts';
import { describeUraItem } from './describe-ura-item.ts';
import { findFirstChangedLine } from './find-first-changed-line.ts';
import type { PeekState } from './peek-state.ts';
import { stepReviewPosition } from './step-review-position.ts';
import { zoneStyles } from './zone-styles.ts';

/** A request to focus an insight from outside (a chat citation); `nonce` repeats a jump. */
export interface InsightJump {
  readonly insightId: string;
  readonly nonce: number;
}

/**
 * A request to show a file's card from outside (the radar tree, the review dock), optionally at a
 * head line; `nonce` repeats a jump.
 */
export interface FileJump {
  readonly path: string;
  readonly line?: number;
  readonly nonce: number;
}

/**
 * A note the composer asks to stage, with the head it was written against. `settle` closes the
 * composer, or keeps it open with the error the owner reports.
 */
export interface UraCreateRequest {
  readonly anchor: UraAnchorView;
  readonly headSha: string;
  readonly draft: UraDraft;
  readonly settle: (error: string | undefined) => void;
}

/** Cards this far outside the viewport mount their diffs ahead of being scrolled to. */
const mountMargin = '1200px 0px';
/** Cards farther away than this unmount theirs, which bounds the DOM of a long stream (ADR 0025). */
const unmountMargin = '6000px 0px';

/**
 * Zone 2: the diff stream. Shows the open session's review as `@pierre/diffs` file cards with a
 * header naming the review kind, ImpactGate banners and agent insights once they arrive. Cards
 * mount their diffs as they near the viewport (ADR 0025). While the zone has focus, `j`/`k` step
 * through every hunk of every file, `p` toggles the active card's call-stack peek (Escape closes
 * it), `]`/`[` move between agent insights, `y`/`d` promote or dismiss the focused one (again
 * to undo), and `m` opens a composer that stages the selected lines, the active hunk or the file
 * into the review dock (ADR 0027). Emits `beuve-mark-reviewed`, `beuve-peek-request`,
 * `beuve-peek-close`, `beuve-insight-status` and `beuve-ura-create`; `beuve-app` does the IPC.
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
    if (event.key === 'm') {
      event.preventDefault();
      this.openComposer();
      return;
    }
    const step = ({ j: 1, k: -1 } as const)[event.key];
    const files = this.review?.files ?? [];
    if (step === undefined || files.length === 0) {
      return;
    }
    event.preventDefault();
    const next = stepReviewPosition(
      files.map((file) => file.hunks.length),
      { file: this.activeIndex, hunk: this.activeHunk },
      step,
    );
    this.activeIndex = next.file;
    this.activeHunk = next.hunk;
    void this.revealPosition();
  };

  private readonly onMarkClick = (): void => {
    this.dispatchEvent(new CustomEvent('beuve-mark-reviewed', { bubbles: true, composed: true }));
  };

  private readonly onInsightFocus = (event: CustomEvent<{ insightId: string }>): void => {
    this.focusInsight(event.detail.insightId);
  };

  private readonly onComposeSubmit = (event: CustomEvent<UraDraft>): void => {
    const { composer, review } = this;
    if (composer === undefined || review === undefined || composer.saving) {
      return;
    }
    this.composer = { ...composer, saving: true, error: '' };
    const request: UraCreateRequest = {
      anchor: composer.anchor,
      headSha: review.headSha,
      draft: event.detail,
      settle: (error): void => {
        if (this.composer?.path !== composer.path) {
          return;
        }
        if (error === undefined) {
          this.closeComposer();
        } else {
          this.composer = { ...composer, saving: false, error };
        }
      },
    };
    this.dispatchEvent(
      new CustomEvent('beuve-ura-create', { detail: request, bubbles: true, composed: true }),
    );
  };

  private readonly onComposeCancel = (): void => {
    this.closeComposer();
  };

  private readonly onNearViewport = (entries: IntersectionObserverEntry[]): void => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        (entry.target as BeuveFileCard).mounted = true;
      }
    }
  };

  private readonly onFarFromViewport = (entries: IntersectionObserverEntry[]): void => {
    for (const entry of entries) {
      if (!entry.isIntersecting) {
        (entry.target as BeuveFileCard).mounted = false;
      }
    }
  };

  private observers:
    | {
        readonly root: Element;
        readonly near: IntersectionObserver;
        readonly far: IntersectionObserver;
      }
    | undefined;

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
  @property({ attribute: false }) accessor fileJump: FileJump | undefined;
  /** Backs hunk expansion in the cards. */
  @property({ attribute: false }) accessor loadFilePair: FilePairLoader | undefined;
  /** The session's URA items, which the cards mark under their lines. */
  @property({ attribute: false }) accessor uraItems: readonly UraItemView[] = [];

  @state() accessor activeIndex = 0;
  /** The active card's hunk `j`/`k` stopped at; `-1` for its header. */
  @state() accessor activeHunk = -1;
  @state() accessor focusedInsightId: string | undefined;
  @state() accessor composer: ComposerState | undefined;

  constructor() {
    super();
    this.addEventListener('keydown', this.onKeyDown);
    this.addEventListener('beuve-insight-focus', this.onInsightFocus as EventListener);
    this.addEventListener('beuve-ura-compose-submit', this.onComposeSubmit as EventListener);
    this.addEventListener('beuve-ura-compose-cancel', this.onComposeCancel);
    this.addController({
      hostDisconnected: (): void => {
        this.disconnectObservers();
      },
    });
  }

  private cards(): NodeListOf<BeuveFileCard> {
    return this.renderRoot.querySelectorAll('beuve-file-card');
  }

  /** Scrolls to the active hunk, or the active card's header. */
  private async revealPosition(): Promise<void> {
    await this.updateComplete;
    const card = this.cards()[this.activeIndex];
    if (card === undefined) {
      return;
    }
    if (this.activeHunk === -1) {
      card.scrollIntoView({ block: 'start' });
      return;
    }
    await card.revealHunk(this.activeHunk);
  }

  /** A click on a card makes it active, at its header unless it already was. */
  private activate(index: number): void {
    if (index === this.activeIndex) {
      return;
    }
    this.activeIndex = index;
    this.activeHunk = -1;
  }

  private focusFile(path: string, line: number | undefined): void {
    const index = this.review?.files.findIndex((file) => file.path === path) ?? -1;
    if (index === -1) {
      return;
    }
    this.activeIndex = index;
    this.activeHunk = -1;
    if (line === undefined) {
      void this.revealPosition();
      return;
    }
    void this.revealLine(index, line);
  }

  private async revealLine(index: number, line: number): Promise<void> {
    await this.updateComplete;
    await this.cards()[index]?.revealLine(line);
  }

  /** `m`: a composer on the active card, staging what {@link BeuveFileCard.stageAnchor} names. */
  private openComposer(): void {
    const { review } = this;
    const file = review?.files[this.activeIndex];
    const card = this.cards()[this.activeIndex];
    const anchor = card?.stageAnchor();
    if (review === undefined || file === undefined || anchor === undefined) {
      return;
    }
    const where = describeUraItem({
      id: '',
      sessionId: review.session.id,
      headSha: review.headSha,
      anchor,
      placement: { kind: 'current', anchor },
      severity: 'issue',
      origin: { kind: 'human' },
      title: '',
      body: '',
      status: { kind: 'staged' },
      createdAt: '',
      updatedAt: '',
    }).anchor;
    this.composer = { path: file.path, anchor, where, saving: false, error: '' };
    void this.revealComposer(anchor);
  }

  private async revealComposer(anchor: UraAnchorView): Promise<void> {
    await this.updateComplete;
    const card = this.cards()[this.activeIndex];
    await card?.revealLine(anchor.kind === 'lines' ? anchor.endLine : undefined);
    const element = await waitForComposer(card);
    element?.focus();
  }

  private closeComposer(): void {
    this.composer = undefined;
    this.focus();
  }

  /**
   * Mounts cards near the viewport and unmounts those far from it. Cards are observed once they
   * have rendered their placeholders, so the first pass sees real heights.
   */
  private async observeCards(): Promise<void> {
    const root = this.renderRoot.querySelector('.body');
    if (root === null) {
      return;
    }
    if (this.observers?.root !== root) {
      this.disconnectObservers();
      this.observers = {
        root,
        near: new IntersectionObserver(this.onNearViewport, { root, rootMargin: mountMargin }),
        far: new IntersectionObserver(this.onFarFromViewport, { root, rootMargin: unmountMargin }),
      };
    }
    const cards = [...this.cards()];
    await Promise.all(cards.map(async (card) => card.updateComplete));
    for (const card of cards) {
      this.observers.near.observe(card);
      this.observers.far.observe(card);
    }
  }

  private disconnectObservers(): void {
    this.observers?.near.disconnect();
    this.observers?.far.disconnect();
    this.observers = undefined;
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
    this.activeHunk = -1;
    void this.revealInsight(fileIndex, insight.id);
  }

  private async revealInsight(fileIndex: number, insightId: string): Promise<void> {
    await this.updateComplete;
    await this.cards()[fileIndex]?.revealInsight(insightId);
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
                ${repeat(
                  review.files,
                  (file) => file.path,
                  (file, index) =>
                    html`<beuve-file-card
                      .file=${file}
                      .loadFilePair=${this.loadFilePair}
                      .activeHunk=${index === this.activeIndex ? this.activeHunk : -1}
                      .impact=${this.impact?.files.find((entry) => entry.path === file.path)}
                      .findings=${this.impact?.findings ?? []}
                      .peek=${this.peek?.path === file.path ? this.peek : undefined}
                      .insights=${this.insights.filter((insight) => insight.path === file.path)}
                      .uraItems=${this.uraItems}
                      .composer=${this.composer?.path === file.path ? this.composer : undefined}
                      .focusedInsightId=${this.focusedInsightId}
                      ?active=${index === this.activeIndex}
                      @click=${(): void => {
                        this.activate(index);
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
      this.activeHunk = -1;
      const path = this.composer?.path;
      const isShown = this.review?.files.some((file) => file.path === path) === true;
      this.composer = isShown ? this.composer : undefined;
    }
    if (!changed.has('review') && !changed.has('insights')) {
      return;
    }
    const isShown = this.insights.some((insight) => insight.id === this.focusedInsightId);
    this.focusedInsightId = isShown ? this.focusedInsightId : undefined;
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has('review')) {
      void this.observeCards();
    }
    const jump = this.insightJump;
    if (jump !== undefined && changed.has('insightJump')) {
      this.focusInsight(jump.insightId);
      return;
    }
    const fileJump = this.fileJump;
    if (fileJump !== undefined && changed.has('fileJump')) {
      this.focusFile(fileJump.path, fileJump.line);
    }
  }
}

/** Polls a few frames for the composer the card renders through the library's annotations. */
async function waitForComposer(card: BeuveFileCard | undefined): Promise<HTMLElement | undefined> {
  for (let frame = 0; card !== undefined && frame < 30; frame += 1) {
    const element =
      card.querySelector('beuve-ura-composer') ??
      card.renderRoot.querySelector('beuve-ura-composer');
    if (element !== null) {
      return element;
    }
    await new Promise((resolve) => {
      requestAnimationFrame(resolve);
    });
  }
  return undefined;
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
