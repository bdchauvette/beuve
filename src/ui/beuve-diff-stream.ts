import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

import type {
  AgentInsightView,
  DiffDisplayView,
  DiffFileView,
  ImpactView,
  InsightStatusView,
  ReviewView,
  UraAnchorView,
  UraItemView,
} from '#contract/ipc-contract.ts';

import './beuve-file-card.ts';
import type {
  BeuveFileCard,
  ComposerState,
  FilePairLoader,
  SuggestionSaveDetail,
} from './beuve-file-card.ts';
import type { UraDraft } from './beuve-ura-composer.ts';
import type { MentionTarget } from './chat-draft.ts';
import { describeDiffDisplay } from './describe-diff-display.ts';
import { describeReviewScope } from './describe-review-scope.ts';
import { describeUraItem } from './describe-ura-item.ts';
import { findFirstChangedLine } from './find-first-changed-line.ts';
import type { FlowState } from './flow-state.ts';
import { minimumSplitWidth } from './minimum-split-width.ts';
import { planDiffLayout } from './plan-diff-layout.ts';
import type { EditTarget } from './plan-edit-target.ts';
import type { PeekState } from './peek-state.ts';
import type { TraceState } from './trace-state.ts';
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
  /** With `line`, selects the lines up to here as well (a chat chip, ADR 0046). */
  readonly endLine?: number;
  /** `base` reads `line` and `endLine` as base-side numbers; head by default. */
  readonly side?: 'head' | 'base';
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
  /** The suggestion an `e` edit produced (ADR 0043), staged with the note. */
  readonly suggestedPatch?: string;
  readonly settle: (error: string | undefined) => void;
}

/** A request from the dock to (re-)edit an item's suggestion; `nonce` repeats it. */
export interface SuggestionJump {
  readonly itemId: string;
  readonly nonce: number;
}

const defaultDisplay: DiffDisplayView = {
  layout: 'split',
  ignoreWhitespace: false,
  sidebarSide: 'right',
};

/** Cards this far outside the viewport mount their diffs ahead of being scrolled to. */
const mountMargin = '1200px 0px';
/** Cards farther away than this unmount theirs, which bounds the DOM of a long stream (ADR 0025). */
const unmountMargin = '6000px 0px';

/**
 * Zone 2: the diff stream. Shows the open session's review as `@pierre/diffs` file cards with a
 * header naming the review kind, ImpactGate banners and agent insights once they arrive. Cards
 * mount their diffs as they near the viewport (ADR 0025). While the zone has focus, `j`/`k` step
 * through every hunk of every file, `p` toggles the active card's call-stack peek (Escape closes
 * it), `r` runs the tests covering the focused hunk with tracing (ADR 0041), `]`/`[` move between agent insights, `y`/`d` promote or dismiss the focused one (again
 * to undo), and `m` opens a composer that stages the selected lines, the active hunk or the file
 * into the review dock (ADR 0027). `s` and `w` toggle side-by-side/inline diffs and hiding
 * whitespace (ADR 0042), `i` opens the focused card's ImpactGate details, and `e` edits the
 * hunk or selected lines into a suggested patch for a new or the underlying note (ADR 0043).
 * Emits `beuve-display-change`, `beuve-ura-update`, `beuve-status-notice`, `beuve-mark-reviewed`, `beuve-peek-request`,
 * `beuve-peek-close`, `beuve-insight-status`, `beuve-ura-create` and `beuve-active-file` (the
 * file the card cursor is on); `beuve-app` does the IPC.
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

      .display {
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
        white-space: nowrap;
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
    if (event.key === 'P') {
      event.preventDefault();
      this.toggleFlow();
      return;
    }
    if (event.key === 'r') {
      event.preventDefault();
      this.requestTrace();
      return;
    }
    if (
      event.key === 'p' ||
      (event.key === 'Escape' &&
        (this.peek !== undefined || this.flow !== undefined || this.trace !== undefined))
    ) {
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
    if (event.key === 'o') {
      event.preventDefault();
      this.openInEditor();
      return;
    }
    if (event.key === 'm') {
      event.preventDefault();
      this.openComposer();
      return;
    }
    if (event.key === 'e') {
      event.preventDefault();
      this.editActive();
      return;
    }
    if (event.key === 'i') {
      event.preventDefault();
      if (this.cards()[this.activeIndex]?.focusImpact() !== true) {
        this.notify('info', 'ImpactGate has nothing to say about this file.');
      }
      return;
    }
    if (event.key === 's' || event.key === 'w') {
      event.preventDefault();
      const detail: Partial<DiffDisplayView> =
        event.key === 's'
          ? { layout: this.display.layout === 'split' ? 'unified' : 'split' }
          : { ignoreWhitespace: !this.display.ignoreWhitespace };
      this.dispatchEvent(
        new CustomEvent('beuve-display-change', { detail, bubbles: true, composed: true }),
      );
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
      ...(composer.suggestedPatch !== undefined && { suggestedPatch: composer.suggestedPatch }),
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

  /** An `e` edit saved: onto the note it was made for, else into a new note's composer. */
  private readonly onSuggestionSave = (event: CustomEvent<SuggestionSaveDetail>): void => {
    const { target, patch } = event.detail;
    if (target.itemId === undefined) {
      this.openComposer(
        { kind: 'lines', path: target.path, startLine: target.startLine, endLine: target.endLine },
        patch,
      );
      return;
    }
    this.dispatchEvent(
      new CustomEvent('beuve-ura-update', {
        detail: { itemId: target.itemId, suggestedPatch: patch },
        bubbles: true,
        composed: true,
      }),
    );
    this.notify('info', 'Suggestion attached to the note.');
    this.focus();
  };

  private readonly onSuggestionCancel = (event: CustomEvent<{ message: string }>): void => {
    if (event.detail.message !== '') {
      this.notify('info', event.detail.message);
    }
    this.focus();
  };

  private readonly onImpactClose = (): void => {
    this.focus();
  };

  private readonly resizeObserver = new ResizeObserver((entries) => {
    const width = entries.at(-1)?.contentRect.width;
    if (width !== undefined && width > 0) {
      this.streamWidth = width;
    }
  });

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
  @property({ attribute: false }) accessor flow: FlowState | undefined;
  @property({ attribute: false }) accessor trace: TraceState | undefined;

  /** Agent insights for `review`'s head, every status. */
  @property({ attribute: false }) accessor insights: readonly AgentInsightView[] = [];
  @property({ attribute: false }) accessor insightJump: InsightJump | undefined;
  @property({ attribute: false }) accessor fileJump: FileJump | undefined;
  /** Backs hunk expansion in the cards. */
  @property({ attribute: false }) accessor loadFilePair: FilePairLoader | undefined;
  /** The session's URA items, which the cards mark under their lines. */
  @property({ attribute: false }) accessor uraItems: readonly UraItemView[] = [];
  /** The reviewer's diff layout and whitespace preference (ADR 0042). */
  @property({ attribute: false }) accessor display: DiffDisplayView = defaultDisplay;
  @property({ attribute: false }) accessor suggestionJump: SuggestionJump | undefined;
  /** The stream's width, which decides whether a split fits. */
  @state() accessor streamWidth: number | undefined;

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
    this.addEventListener('beuve-suggestion-save', this.onSuggestionSave as EventListener);
    this.addEventListener('beuve-suggestion-cancel', this.onSuggestionCancel as EventListener);
    this.addEventListener('beuve-impact-close', this.onImpactClose);
    this.addController({
      hostConnected: (): void => {
        this.resizeObserver.observe(this);
      },
      hostDisconnected: (): void => {
        this.resizeObserver.disconnect();
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

  private focusFile(jump: FileJump): void {
    const { path, line } = jump;
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
    if (jump.endLine !== undefined) {
      void this.revealRange(index, line, jump.endLine, jump.side ?? 'head');
      return;
    }
    void this.revealLine(index, line);
  }

  private async revealRange(
    index: number,
    start: number,
    end: number,
    side: 'head' | 'base',
  ): Promise<void> {
    await this.updateComplete;
    await this.cards()[index]?.revealRange(start, end, side);
  }

  private async revealLine(index: number, line: number): Promise<void> {
    await this.updateComplete;
    await this.cards()[index]?.revealLine(line);
  }

  /** `o`: asks the shell to open the active card's file in the editor at the cursor line. */
  private openInEditor(): void {
    const file = this.review?.files[this.activeIndex];
    const line = this.cards()[this.activeIndex]?.editorLine();
    if (file === undefined || line === undefined) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent('beuve-open-editor', {
        detail: { path: file.path, line },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private notify(tone: 'info' | 'error', text: string): void {
    this.dispatchEvent(
      new CustomEvent('beuve-status-notice', {
        detail: { tone, text },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** `e`: edits what {@link BeuveFileCard.editTarget} names on the active card. */
  private editActive(): void {
    const { review } = this;
    const card = this.cards()[this.activeIndex];
    const target =
      review === undefined ? undefined : card?.editTarget(this.uraItems, review.headSha);
    if (card === undefined || target === undefined) {
      this.notify('info', 'Pick a hunk with j/k, or select head lines, to suggest an edit.');
      return;
    }
    void card.startEdit(target);
  }

  /** The dock asked to (re-)edit an item's suggestion: its file, its lines, attached to it. */
  private async editItem(itemId: string): Promise<void> {
    const item = this.uraItems.find((entry) => entry.id === itemId);
    const anchor = item?.placement.kind === 'current' ? item.placement.anchor : undefined;
    const index =
      anchor?.kind === 'lines'
        ? (this.review?.files.findIndex((file) => file.path === anchor.path) ?? -1)
        : -1;
    if (index === -1 || item === undefined || anchor?.kind !== 'lines') {
      this.notify('error', 'That note is not on a line of this diff, so it cannot be edited here.');
      return;
    }
    if (item.headSha !== this.review?.headSha) {
      this.notify('error', 'That note was written on an older head; stage a new one to suggest.');
      return;
    }
    this.activeIndex = index;
    this.activeHunk = -1;
    await this.updateComplete;
    const target: EditTarget = {
      path: anchor.path,
      startLine: anchor.startLine,
      endLine: anchor.endLine,
      itemId,
      ...(item.suggestedPatch !== undefined && { patch: item.suggestedPatch }),
    };
    await this.cards()[index]?.startEdit(target);
  }

  /**
   * `m`: a composer on the active card, staging what {@link BeuveFileCard.stageAnchor} names, or
   * `anchor` with the suggestion an `e` edit produced.
   */
  private openComposer(given?: UraAnchorView, suggestedPatch?: string): void {
    const { review } = this;
    const file = review?.files[this.activeIndex];
    const card = this.cards()[this.activeIndex];
    const anchor = given ?? card?.stageAnchor();
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
    this.composer = {
      path: file.path,
      anchor,
      where,
      saving: false,
      error: '',
      ...(suggestedPatch !== undefined && { suggestedPatch }),
    };
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

  /** `p` toggles the call-stack peek of the active card; Escape closes whichever portal is open. */
  private togglePeek(isClosing: boolean): void {
    const file = this.review?.files[this.activeIndex];
    if (isClosing || file === undefined || this.peek?.path === file.path) {
      this.closePortals();
      return;
    }
    this.dispatchEvent(
      new CustomEvent('beuve-peek-request', {
        detail: { path: file.path, line: this.targetLine(file) },
        bubbles: true,
        composed: true,
      }),
    );
    this.focus();
  }

  /** `Shift+p` toggles the control-flow graph of the function around the same line `p` targets. */
  private toggleFlow(): void {
    const file = this.review?.files[this.activeIndex];
    if (file === undefined || this.flow?.path === file.path) {
      this.closePortals();
      return;
    }
    this.dispatchEvent(
      new CustomEvent('beuve-flow-request', {
        detail: { path: file.path, line: this.targetLine(file) },
        bubbles: true,
        composed: true,
      }),
    );
    this.focus();
  }

  /**
   * `r` runs the tests covering the focused hunk (else the file's first change) with tracing and
   * opens the timeline portal; pressing it while the same probe runs does nothing.
   */
  private requestTrace(): void {
    const file = this.review?.files[this.activeIndex];
    if (file === undefined) {
      return;
    }
    const line = this.targetLine(file);
    if (
      this.trace?.status === 'loading' &&
      this.trace.path === file.path &&
      this.trace.line === line
    ) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent('beuve-trace-request', {
        detail: { path: file.path, line },
        bubbles: true,
        composed: true,
      }),
    );
    this.focus();
  }

  /** The first changed head line of the focused hunk, else of the file. */
  private targetLine(file: DiffFileView): number | undefined {
    return (
      (this.activeHunk === -1 ? undefined : findFirstChangedLine(file.patch, this.activeHunk)) ??
      findFirstChangedLine(file.patch)
    );
  }

  private closePortals(): void {
    if (this.peek !== undefined) {
      this.dispatchEvent(new CustomEvent('beuve-peek-close', { bubbles: true, composed: true }));
    }
    if (this.flow !== undefined) {
      this.dispatchEvent(new CustomEvent('beuve-flow-close', { bubbles: true, composed: true }));
    }
    if (this.trace !== undefined) {
      this.dispatchEvent(new CustomEvent('beuve-trace-close', { bubbles: true, composed: true }));
    }
    this.focus();
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
        ${this.renderDisplay()}
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
                      .diffStyle=${planDiffLayout(file.status, this.display.layout, this.streamWidth).style}
                      .cognitiveLimit=${this.impact?.cognitiveMax}
                      .loadFilePair=${this.loadFilePair}
                      .activeHunk=${index === this.activeIndex ? this.activeHunk : -1}
                      .impact=${this.impact?.files.find((entry) => entry.path === file.path)}
                      .findings=${this.impact?.findings ?? []}
                      .peek=${this.peek?.path === file.path ? this.peek : undefined}
                      .flow=${this.flow?.path === file.path ? this.flow : undefined}
                      .trace=${this.trace?.path === file.path ? this.trace : undefined}
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

  private renderDisplay(): TemplateResult {
    const isNarrow = this.streamWidth !== undefined && this.streamWidth < minimumSplitWidth;
    const label = describeDiffDisplay(this.display, isNarrow);
    return html`<span class="display" title=${label.title}>${label.text}</span>`;
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

  /** What ⌘> adds to the chat (ADR 0046): the active card's selection, hunk or file. */
  chatMention(): MentionTarget | undefined {
    return this.cards()[this.activeIndex]?.chatMention();
  }

  override render(): TemplateResult {
    return html`
      ${this.review === undefined ? this.renderWelcome() : this.renderReview(this.review)}
    `;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('review')) {
      // The same head again (e.g. whitespace toggled) keeps the cursor on its file.
      const previous = changed.get('review');
      const activePath = previous?.files[this.activeIndex]?.path;
      const kept =
        previous?.headSha === this.review?.headSha
          ? (this.review?.files.findIndex((file) => file.path === activePath) ?? -1)
          : -1;
      this.activeIndex = Math.max(0, kept);
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
    if (changed.has('review') || changed.has('activeIndex')) {
      this.dispatchEvent(
        new CustomEvent('beuve-active-file', {
          detail: { path: this.review?.files[this.activeIndex]?.path },
          bubbles: true,
          composed: true,
        }),
      );
    }
    const jump = this.insightJump;
    if (jump !== undefined && changed.has('insightJump')) {
      this.focusInsight(jump.insightId);
      return;
    }
    const fileJump = this.fileJump;
    if (fileJump !== undefined && changed.has('fileJump')) {
      this.focusFile(fileJump);
    }
    const suggestionJump = this.suggestionJump;
    if (suggestionJump !== undefined && changed.has('suggestionJump')) {
      void this.editItem(suggestionJump.itemId);
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
