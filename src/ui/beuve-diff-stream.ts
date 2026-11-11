import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

import type {
  DiffDisplayView,
  DiffFileView,
  FileReviewProgressView,
  FileReviewStateView,
  ReviewOrderMode,
  ReviewOrderView,
  ReviewView,
  UpdateUraItemRequest,
  UraAnchorView,
  UraItemView,
} from '#contract/ipc-contract.ts';

import type { CommandId } from '#contract/command-catalog.ts';

import './beuve-commit-pairing.ts';
import type { CommitPairFilterDetail } from './beuve-commit-pairing.ts';
import './beuve-file-card.ts';
import './beuve-find-bar.ts';
import type { FileDiagnostics } from './file-diagnostics.ts';
import type { ReviewInsight } from './merge-review-insights.ts';
import type { ImageLoader } from './rich-view/beuve-rich-view.ts';
import type { BeuveFindBar, FindQueryDetail, FindStepDetail } from './beuve-find-bar.ts';
import type { DiffToggleDetail, SideLines, SuggestionCancelDetail } from './beuve-file-card.ts';
import type {
  BeuveFileCard,
  ComposerState,
  FilePairLoader,
  NoteEditDetail,
  SuggestionSaveDetail,
} from './beuve-file-card.ts';
import type { UraDraft } from './beuve-ura-composer.ts';
import { noteEditFrom } from './note-edit-from.ts';
import type { NoteEdit } from './note-edit-from.ts';
import { ActionDelegation } from './action-delegation.ts';
import { withPayload } from './with-payload.ts';
import type { MentionTarget } from './chat-draft.ts';
import { describeDiffDisplay } from './describe-diff-display.ts';
import { SelectionMatches } from './selection-matches.ts';
import { shortcutOf } from './shortcut-of.ts';
import { keyPlatformOf } from './key-platform-of.ts';
import { describeOrderFallback } from './describe-order-fallback.ts';
import { displayIcon } from './display-icon.ts';
import { describeReviewProgress } from './describe-review-progress.ts';
import { describeReviewScope } from './describe-review-scope.ts';
import { describeUraItem } from './describe-ura-item.ts';
import { anchorFromTarget } from './anchor-from-target.ts';
import { lineFromTarget } from './line-from-target.ts';
import type { ClickedToken } from './run-sheet-action.ts';
import { mentionFromTarget } from './mention-from-target.ts';
import type { ReviewTarget } from './target-from.ts';
import { findInReview } from './find-in-review.ts';
import type { ReviewMatch } from './find-in-review.ts';
import { groupStable } from './group-stable.ts';
import type { FlowState } from './flow-state.ts';
import { minimumSplitWidth } from './minimum-split-width.ts';
import { planDiffLayout } from './plan-diff-layout.ts';
import { planReviewStream } from './plan-review-stream.ts';
import type { ReviewStreamPlan } from './plan-review-stream.ts';
import type { DiffDeferral } from './plan-diff-deferrals.ts';
import { editTargetFrom } from './edit-target-from.ts';
import type { EditTarget } from './edit-target-from.ts';
import type { PeekState } from './peek-state.ts';
import { stepReviewPositionSkipping } from './step-review-position-skipping.ts';
import type { ReviewStops } from './step-review-position-skipping.ts';
import { cardIndexAtLine } from './card-index-at-line.ts';
import { zoneStyles } from './zone-styles.ts';
import { buttonStyles } from './primitives/button-styles.ts';
import { segmentedStyles } from './primitives/segmented-styles.ts';
import { menuItemStyles } from './primitives/menu-item-styles.ts';
import './primitives/beuve-commit.ts';
import './primitives/beuve-time.ts';
import './primitives/beuve-menu.ts';

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
  /** The suggestion an Suggest Edit edit produced (ADR 0043), staged with the note. */
  readonly suggestedPatch?: string;
  readonly settle: (error: string | undefined) => void;
}

/** What a composer opens with besides its lines: a new note's suggestion, or the note it edits. */
interface ComposerOptions {
  readonly suggestedPatch?: string;
  readonly edit?: NoteEdit;
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
  showGenerated: false,
  showInsights: true,
  showDiagnostics: true,
};

const noUraItems: readonly UraItemView[] = [];
const noInsights: readonly ReviewInsight[] = [];
const noDiagnostics: ReadonlyMap<string, FileDiagnostics> = new Map();
const noPaths: ReadonlySet<string> = new Set();
/** {@link findInReview}'s default cap. */
const findLimit = 5000;
const noDeferrals: ReadonlyMap<string, DiffDeferral> = new Map();
const noMarks: ReadonlyMap<string, FileReviewStateView> = new Map();
const emptyPlan: ReviewStreamPlan = { files: [], groupLabels: new Map() };
const layouts: readonly DiffDisplayView['layout'][] = ['split', 'unified'];

const orderModes: readonly { readonly mode: ReviewOrderMode; readonly label: string }[] = [
  { mode: 'path', label: 'Path' },
  { mode: 'imports', label: 'Imports' },
  { mode: 'calls', label: 'Calls' },
];

/** Cards this far outside the viewport mount their diffs ahead of being scrolled to. */
// eslint-disable-next-line local/css-design-tokens -- IntersectionObserver rootMargin takes no var(); a virtualization distance (ADR 0025), not a design value.
const mountMargin = '1200px 0px';
/** Cards farther away than this unmount theirs, which bounds the DOM of a long stream (ADR 0025). */
// eslint-disable-next-line local/css-design-tokens -- IntersectionObserver rootMargin takes no var(); a virtualization distance (ADR 0025), not a design value.
const unmountMargin = '6000px 0px';

/** What the card's gutter button asks for: a note composer on `anchor`. */
interface NoteAddDetail {
  readonly anchor: UraAnchorView;
}

/** `beuve-open-commit`: a commit hash of the header, to open on the remote (ADR 0108). */
export interface OpenCommitDetail {
  readonly sha: string;
}

/**
 * Zone 2: the diff stream. Shows the open session's review as `@pierre/diffs` file cards with a
 * header naming the review kind. Cards
 * mount their diffs as they near the viewport (ADR 0025). While the zone has focus, Next/Previous Change step
 * through every hunk of every file, Show Callers toggles the active card's call-stack peek (Escape closes
 * it), and Add Note opens a composer
 * that stages the target into the review dock (ADR 0027); a staged note's marker (double-click or
 * Edit) opens it in the same composer, which saves it through `beuve-ura-update` (ADR 0129). Every line-taking action reads one
 * target: the selection, a jump's line, the focused hunk or the file (ADR 0063). View ▸ Diff switches side-by-side/inline diffs and hiding
 * whitespace (ADR 0042), and Suggest Edit edits the
 * hunk or selected lines into a suggested patch for a new or the underlying note (ADR 0043).
 * File Reviewed marks the active file reviewed or not (ADR 0064): reviewed cards collapse to their header,
 * and Next/Previous Change can skip them. Files show in the order main computed (ADR 0065), with a divider
 * above the config and mechanical group, and an interdiff's commit pairs can narrow the stream
 * to what one commit produced (ADR 0054).
 * Emits `beuve-display-change`, `beuve-ura-update`, `beuve-status-notice`, `beuve-mark-reviewed`, `beuve-peek-request`,
 * `beuve-peek-close`, `beuve-open-commit`, `beuve-ura-create`, `beuve-file-reviewed` and `beuve-active-file` (the
 * file the card cursor is on); `beuve-app` does the IPC.
 */
@customElement('beuve-diff-stream')
export class BeuveDiffStream extends LitElement {
  static override styles = [
    menuItemStyles,
    segmentedStyles,
    buttonStyles,
    zoneStyles,
    css`
      :host {
        background: var(--beuve-bg);
      }

      .welcome {
        display: grid;
        block-size: 100%;
        place-items: center;
      }

      .welcome > div {
        max-inline-size: var(--beuve-size-column);
        text-align: center;
      }

      .welcome h1 {
        margin: 0 0 var(--beuve-space-2);
        font-size: var(--beuve-font-size-title);
        font-weight: var(--beuve-font-weight-semibold);
      }

      .welcome p {
        margin: 0 0 var(--beuve-space-3);
        color: var(--beuve-text-muted);
      }

      .note {
        display: inline-block;
        padding: var(--beuve-space-1) var(--beuve-space-3);
        border: var(--beuve-border-width) solid var(--beuve-border);
        border-radius: var(--beuve-radius);
        background: var(--beuve-surface);
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      .note.error {
        color: var(--beuve-danger);
      }

      .welcome > .opening {
        display: grid;
        justify-items: center;
        gap: var(--beuve-space-3);
        animation: opening-in 160ms ease-out both;
      }

      .opening-label {
        font-size: var(--beuve-font-size-large);
        font-weight: var(--beuve-font-weight-semibold);
        overflow-wrap: anywhere;
      }

      .opening-bar {
        position: relative;
        inline-size: var(--beuve-size-field);
        block-size: var(--beuve-border-width-heavy);
        overflow: hidden;
        border-radius: var(--beuve-radius-tiny);
        background: var(--beuve-accent-soft);
      }

      .opening-bar::after {
        position: absolute;
        inset-block: 0;
        inset-inline: 0 auto;
        inline-size: 40%;
        border-radius: inherit;
        background: var(--beuve-accent);
        content: '';
        animation: opening-slide 1.1s ease-in-out infinite;
      }

      @keyframes opening-in {
        from {
          opacity: 0;
          transform: translateY(var(--beuve-space-1)) scale(0.98);
        }
      }

      @keyframes opening-slide {
        from {
          transform: translateX(-100%);
        }
        to {
          transform: translateX(250%);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .welcome > .opening {
          animation: none;
        }

        .opening-bar::after {
          inline-size: 100%;
          animation: none;
          opacity: 0.6;
        }
      }

      .summary {
        display: flex;
        align-items: center;
        gap: var(--beuve-space-3);
        flex: none;
        padding: var(--beuve-space-2) var(--beuve-space-3);
        border-block-end: var(--beuve-border-width) solid var(--beuve-border);
        background: var(--beuve-surface);
      }

      .scope {
        font-weight: var(--beuve-font-weight-semibold);
      }

      .scope.interdiff {
        color: var(--beuve-violet);
      }

      .range,
      .counts {
        font: var(--beuve-font-code);
        color: var(--beuve-text-muted);
      }

      .spacer {
        flex: 1;
      }

      .saved {
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
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

      .progress {
        font: var(--beuve-font-small);
        font-variant-numeric: tabular-nums;
        color: var(--beuve-text-muted);
        white-space: nowrap;
      }

      .order {
        display: inline-flex;
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
        white-space: nowrap;
      }

      .order-button {
        border-color: var(--beuve-border);
      }

      .order.fell-back .order-button::after {
        content: '';
        inline-size: var(--beuve-size-dot-small);
        block-size: var(--beuve-size-dot-small);
        border-radius: 50%;
        background: var(--beuve-warn-solid);
      }

      .tools {
        display: inline-flex;
        align-items: center;
        font: var(--beuve-font-small);
        gap: var(--beuve-space-3);
      }

      .segmented > button.effective {
        outline: var(--beuve-border-width) dashed var(--beuve-text-muted);
        outline-offset: calc(-1 * var(--beuve-border-width-heavy));
      }

      .group {
        display: flex;
        align-items: center;
        gap: var(--beuve-space-2);
        margin-block-start: var(--beuve-space-3);
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      .group::after {
        content: '';
        flex: 1;
        block-size: var(--beuve-border-width);
        background: var(--beuve-border);
      }

      .pairs {
        margin-block-end: var(--beuve-space-3);
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      .pairs summary {
        display: flex;
        align-items: baseline;
        gap: var(--beuve-space-2);
        padding: var(--beuve-space-0-5) 0;
        cursor: pointer;
        list-style: none;
      }

      .pairs summary::before {
        content: '▸';
        font-size: var(--beuve-font-size-caption);
      }

      .pairs[open] summary::before {
        content: '▾';
      }

      .pairs .filtered {
        color: var(--beuve-text);
      }

      .pairs beuve-commit-pairing {
        margin-block-start: var(--beuve-space-1);
        padding: var(--beuve-space-2) 0;
        border-block-start: var(--beuve-border-width) solid var(--beuve-border);
        border-block-end: var(--beuve-border-width) solid var(--beuve-border);
      }
    `,
  ];

  /** Esc in place (ADR 0068): closes a portal, else the commit filter. Every other key is a menu's. */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (
      event.key !== 'Escape' ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.defaultPrevented
    ) {
      return;
    }
    if (this.peek !== undefined || this.flow !== undefined) {
      event.preventDefault();
      this.togglePeek(true);
      return;
    }
    if (this.pairFilter === undefined) {
      return;
    }

    event.preventDefault();
    this.pairFilter = undefined;
  };

  private readonly onPairFilter = (event: CustomEvent<CommitPairFilterDetail>): void => {
    event.stopPropagation();
    this.pairFilter = event.detail.pairId;
  };

  private readonly onPairsToggle = (event: Event): void => {
    this.isPairsOpen = (event.currentTarget as HTMLDetailsElement).open;
  };

  private readonly onMarkClick = (): void => {
    this.dispatchEvent(new CustomEvent('beuve-mark-reviewed', { bubbles: true, composed: true }));
  };

  private readonly onComposeSubmit = (event: CustomEvent<UraDraft>): void => {
    const { composer, review } = this;
    if (composer === undefined || review === undefined || composer.saving) {
      return;
    }
    if (composer.edit !== undefined) {
      this.saveEdit(composer.edit, event.detail);
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

  /** The gutter button: a composer on the lines it was clicked for. */
  private readonly onNoteAdd = (event: CustomEvent<NoteAddDetail>): void => {
    event.stopPropagation();
    this.openComposer(event.detail.anchor);
  };

  /** A staged note's marker, double-clicked or its Edit button: the composer edits it there. */
  private readonly onNoteEdit = (event: CustomEvent<NoteEditDetail>): void => {
    event.stopPropagation();
    this.editNote(event.detail.itemId);
  };

  private readonly onComposeCancel = (): void => {
    this.closeComposer();
  };

  /** An Suggest Edit edit saved: onto the note it was made for, else into a new note's composer. */
  private readonly onSuggestionSave = (event: CustomEvent<SuggestionSaveDetail>): void => {
    const { target, patch } = event.detail;
    if (target.itemId === undefined) {
      this.openComposer(
        { kind: 'lines', path: target.path, startLine: target.startLine, endLine: target.endLine },
        { suggestedPatch: patch },
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

  private readonly onSuggestionCancel = (event: CustomEvent<SuggestionCancelDetail>): void => {
    if (event.detail.message !== '') {
      this.notify('info', event.detail.message);
    }
    this.focus();
  };

  private readonly onFindQuery = (event: CustomEvent<FindQueryDetail>): void => {
    this.findQuery = event.detail.query;
    this.isFindCaseSensitive = event.detail.isCaseSensitive;
    this.runFind();
    const first = this.findMatches.findIndex((match) => match.fileIndex >= this.activeIndex);
    this.showMatch(Math.max(0, first));
  };

  private readonly onFindStep = (event: CustomEvent<FindStepDetail>): void => {
    const count = this.findMatches.length;
    if (count === 0) {
      return;
    }
    let from = this.findIndex;
    if (from === -1 && event.detail.step === -1) {
      from = 0;
    }
    this.showMatch((from + event.detail.step + count) % count);
  };

  private readonly onFindClose = (): void => {
    this.isFindOpen = false;
    this.focus();
  };

  /** "Load diff" on a collapsed card. */
  private readonly onDiffToggle = (event: CustomEvent<DiffToggleDetail>): void => {
    const index = this.shownFiles().findIndex((file) => file.path === event.detail.path);
    if (index === -1) {
      return;
    }
    this.activeIndex = index;
    this.activeHunk = -1;
    this.setCollapsed(event.detail.path, !event.detail.expand);
  };

  /** A press on the body itself (not a card in it) is a grab of its scrollbar. */
  private readonly onBodyPointerDown = (event: PointerEvent): void => {
    if (event.target === event.currentTarget) {
      this.isReaderScrolling = true;
    }
  };

  /**
   * Once the reviewer's own scroll settles, the card whose header is pinned at the top becomes the
   * active one, so File Reviewed and the other active-card commands act on the file being read.
   * Reveals scroll the active card into view themselves, so they leave it alone.
   */
  private readonly onScrollEnd = (event: Event): void => {
    if (!this.isReaderScrolling) {
      return;
    }
    this.isReaderScrolling = false;
    const body = event.currentTarget as HTMLElement;
    const spans = Array.from(this.cards(), (card) => {
      const rect = card.getBoundingClientRect();
      return { blockStart: rect.top, blockEnd: rect.bottom };
    });
    const index = cardIndexAtLine(spans, body.getBoundingClientRect().top);
    if (index !== -1) {
      this.activate(index);
    }
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

  /**
   * Per-file slices of the stream's arrays, rebuilt only when their source array changes and
   * keeping each file's slice while its members are the same, so a card's properties change only
   * when its own data does and Next/Previous Change update one or two cards, not all of them (ADR 0050).
   */
  private slices: {
    readonly uraItems: readonly UraItemView[];
    readonly uraItemsByPath: ReadonlyMap<string, readonly UraItemView[]>;
    readonly insights: readonly ReviewInsight[];
    readonly insightsByPath: ReadonlyMap<string, readonly ReviewInsight[]>;
  } = {
    uraItems: noUraItems,
    uraItemsByPath: new Map(),
    insights: noInsights,
    insightsByPath: new Map(),
  };

  private planCache:
    | {
        readonly review: ReviewView;
        readonly order: ReviewOrderView | undefined;
        readonly pairId: string | undefined;
        readonly plan: ReviewStreamPlan;
      }
    | undefined;

  private observers:
    | {
        readonly root: Element;
        readonly near: IntersectionObserver;
        readonly far: IntersectionObserver;
      }
    | undefined;

  /** Whether the reviewer scrolled the stream since it last settled, rather than a reveal. */
  private isReaderScrolling = false;

  /** Wheel, touch and scrollbar input: the scroll that follows is the reviewer's own. */
  private readonly scrollIntent = {
    handleEvent: (): void => {
      this.isReaderScrolling = true;
    },
    passive: true,
  };

  @property({ type: Boolean, reflect: true }) accessor focused = false;

  /** What `session:list` said, shown while no session is open. */
  @property() accessor sessionNote = 'Loading sessions…';
  @property({ attribute: false }) accessor review: ReviewView | undefined;
  @property({ type: Boolean }) accessor loading = false;
  /** Names the session being opened, shown while `loading` and no review has arrived. */
  @property() accessor loadingLabel = '';
  @property({ type: Boolean }) accessor marking = false;
  /** The checkpoint Save Progress recorded in this window for this session, if any. */
  @property({ attribute: false }) accessor savedProgress:
    { readonly sha: string; readonly at: Temporal.Instant } | undefined;
  /** `process.platform`, for the shortcuts in tooltips. */
  @property() accessor platform = '';
  @property() accessor error = '';
  @property({ attribute: false }) accessor peek: PeekState | undefined;
  @property({ attribute: false }) accessor flow: FlowState | undefined;

  @property({ attribute: false }) accessor fileJump: FileJump | undefined;
  /** Backs hunk expansion in the cards. */
  @property({ attribute: false }) accessor loadFilePair: FilePairLoader | undefined;
  /** Reads repository images for the rendered files (ADR 0123). */
  @property({ attribute: false }) accessor loadImage: ImageLoader | undefined;
  /** The session's URA items, which the cards mark under their lines. */
  @property({ attribute: false }) accessor uraItems: readonly UraItemView[] = [];
  /** `/review` findings to show as notes under their lines, not yet staged (ADR 0061). */
  @property({ attribute: false }) accessor insights: readonly ReviewInsight[] = noInsights;
  /** The language servers' diagnostics per file path, for the head on screen (ADR 0111). */
  @property({ attribute: false }) accessor diagnostics: ReadonlyMap<string, FileDiagnostics> =
    noDiagnostics;
  /** The reviewer's diff layout and whitespace preference (ADR 0042). */
  @property({ attribute: false }) accessor display: DiffDisplayView = defaultDisplay;
  @property({ attribute: false }) accessor suggestionJump: SuggestionJump | undefined;
  /** Files that start collapsed and why (ADR 0052), from {@link planDiffDeferrals}. */
  @property({ attribute: false }) accessor deferrals: ReadonlyMap<string, DiffDeferral> =
    noDeferrals;
  /** Each file's reviewed mark (ADR 0064), by head path; reviewed files collapse. */
  @property({ attribute: false }) accessor reviewMarks: ReadonlyMap<string, FileReviewStateView> =
    noMarks;
  @property({ attribute: false }) accessor reviewProgress: FileReviewProgressView | undefined;
  /** `session:get-order` for the review (ADR 0065); path order until it answers. */
  @property({ attribute: false }) accessor order: ReviewOrderView | undefined;
  /** The commit pair the stream is narrowed to (ADR 0054), from `beuve-commit-pairing`. */
  @state() accessor pairFilter: string | undefined;
  @state() accessor isPairsOpen = false;
  /** Deferred files the reviewer loaded, and other files they collapsed with Space. */
  @state() accessor expandedPaths: ReadonlySet<string> = noPaths;
  @state() accessor collapsedPaths: ReadonlySet<string> = noPaths;
  /** "Find in review" (ADR 0051): the bar, its query and hits, and the hit shown. */
  @state() accessor isFindOpen = false;
  @state() accessor findQuery = '';
  @state() accessor isFindCaseSensitive = false;
  @state() accessor findMatches: readonly ReviewMatch[] = [];
  @state() accessor findIndex = -1;
  /** The stream's width, which decides whether a split fits. */
  @state() accessor streamWidth: number | undefined;

  @state() accessor activeIndex = 0;
  /** The active card's hunk Next/Previous Change stopped at; `-1` for its header. */
  @state() accessor activeHunk = -1;
  @state() accessor composer: ComposerState | undefined;

  constructor() {
    super();
    // ADR 0074: the cards' clicks, keys and pointer moves reach their cards through these, so a
    // card adds no listener per event type of its own. A card's control that stops a click's
    // propagation keeps it from the host's listener, which activates the card.
    this.addController(
      new ActionDelegation(this, {
        click: {
          card: forwardToCard,
          order: withPayload(
            ({ mode }) => {
              return orderModes.find((entry) => entry.mode === mode)?.mode;
            },
            (mode): void => {
              this.chooseOrder(mode);
            },
          ),
          layout: withPayload(
            ({ layout }) => {
              return layouts.find((entry) => entry === layout);
            },
            (layout): void => {
              this.changeDisplay({ layout });
            },
          ),
          whitespace: (): void => {
            this.changeDisplay({ ignoreWhitespace: !this.display.ignoreWhitespace });
          },
          'open-commit': ({ sha }): void => {
            if (sha !== undefined) {
              this.dispatchEvent(
                new CustomEvent('beuve-open-commit', {
                  detail: { sha },
                  bubbles: true,
                  composed: true,
                }),
              );
            }
          },
        },
        dblclick: { card: forwardToCard },
        keydown: { card: forwardToCard },
        pointermove: {
          card: (_data, _event, card): void => {
            (card as BeuveFileCard).notePointerMove();
          },
        },
      }),
    );
    this.addController(
      new ActionDelegation(
        this,
        {
          click: {
            card: ({ index }): void => {
              this.activate(Number(index));
            },
          },
        },
        'host',
      ),
    );
    this.addEventListener('keydown', this.onKeyDown);
    this.addEventListener('beuve-ura-compose-submit', this.onComposeSubmit as EventListener);
    this.addEventListener('beuve-ura-compose-cancel', this.onComposeCancel);
    this.addEventListener('beuve-suggestion-save', this.onSuggestionSave as EventListener);
    this.addEventListener('beuve-note-add', this.onNoteAdd as EventListener);
    this.addEventListener('beuve-note-edit', this.onNoteEdit as EventListener);
    this.addEventListener('beuve-suggestion-cancel', this.onSuggestionCancel as EventListener);
    this.addEventListener('beuve-diff-toggle', this.onDiffToggle as EventListener);
    this.addEventListener('beuve-find-query', this.onFindQuery as EventListener);
    this.addEventListener('beuve-find-step', this.onFindStep as EventListener);
    this.addEventListener('beuve-find-close', this.onFindClose);
    // ADR 0126: other occurrences of the text selected in a card's code, across the cards shown.
    this.addController(
      new SelectionMatches(() => {
        return [...this.cards()].flatMap((card) => {
          return card.codeRoot() ?? [];
        });
      }),
    );
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

  private step(step: 1 | -1, isByFile: boolean): void {
    const files = this.shownFiles();
    if (files.length === 0) {
      return;
    }
    const isSkipping = this.display.skipReviewed === true;
    const stops: ReviewStops = {
      hunkCounts: files.map((file) => {
        if (isByFile || this.isCollapsed(file)) {
          return 0;
        }
        return file.hunks.length;
      }),
      skipped: files.map((file) => isSkipping && this.reviewMarks.get(file.path) === 'yes'),
    };
    let hunk = this.activeHunk;
    if (isByFile) {
      hunk = -1;
    }
    const next = stepReviewPositionSkipping(stops, { file: this.activeIndex, hunk }, step);
    this.activeIndex = next.file;
    this.activeHunk = next.hunk;
    void this.revealPosition();
  }

  /** Find Next or Previous: steps through the hits while the find bar is open, else opens it. */
  private findStep(step: 1 | -1): void {
    if (this.isFindOpen) {
      this.onFindStep(new CustomEvent('beuve-find-step', { detail: { step } }));
    } else {
      void this.openFind();
    }
  }

  private cards(): NodeListOf<BeuveFileCard> {
    return this.renderRoot.querySelectorAll('beuve-file-card');
  }

  /**
   * Whether a card shows only its header (ADR 0052): the reviewer collapsed it, or it is deferred
   * and they haven't loaded it, unless it is only generated and generated files are shown.
   */
  private isCollapsed(file: DiffFileView): boolean {
    if (this.collapsedPaths.has(file.path)) {
      return true;
    }
    if (this.expandedPaths.has(file.path)) {
      return false;
    }
    const deferral = this.deferrals.get(file.path);
    const isDeferred =
      deferral !== undefined && !(deferral.isGeneratedOnly && this.display.showGenerated);
    return isDeferred || this.reviewMarks.get(file.path) === 'yes';
  }

  /** The files the stream shows, in order, narrowed to the chosen commit pair; cached. */
  private plan(): ReviewStreamPlan {
    const { review, order, pairFilter } = this;
    if (review === undefined) {
      return emptyPlan;
    }
    const cached = this.planCache;
    if (cached?.review === review && cached.order === order && cached.pairId === pairFilter) {
      return cached.plan;
    }
    const plan = planReviewStream(review, order, pairFilter);
    this.planCache = { review, order, pairId: pairFilter, plan };
    return plan;
  }

  private shownFiles(): readonly DiffFileView[] {
    return this.plan().files;
  }

  /** File Reviewed: asks the shell to mark the active file reviewed, or to take the mark back. */
  private toggleReviewed(): void {
    const file = this.shownFiles()[this.activeIndex];
    if (file === undefined || this.review?.reviewProgress === undefined) {
      return;
    }
    const isReviewed = this.reviewMarks.get(file.path) === 'yes';
    this.dispatchEvent(
      new CustomEvent('beuve-file-reviewed', {
        detail: { path: file.path, reviewed: !isReviewed },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * A mark that changed drops the reviewer's own expand or collapse of that file, so a reviewed
   * file collapses and an unmarked one opens; the cursor goes to a newly collapsed card's header.
   */
  private applyMarkChanges(previous: ReadonlyMap<string, FileReviewStateView>): void {
    const changed = new Set(
      [...new Set([...previous.keys(), ...this.reviewMarks.keys()])].filter((path) => {
        return previous.get(path) !== this.reviewMarks.get(path);
      }),
    );
    if (changed.size === 0 || previous.size === 0) {
      return;
    }
    const without = (paths: ReadonlySet<string>): ReadonlySet<string> => {
      const kept = new Set(paths);
      for (const path of changed) {
        kept.delete(path);
      }
      return kept;
    };
    this.expandedPaths = without(this.expandedPaths);
    this.collapsedPaths = without(this.collapsedPaths);
    const active = this.shownFiles()[this.activeIndex]?.path;
    if (active === undefined || !changed.has(active) || this.reviewMarks.get(active) !== 'yes') {
      return;
    }
    this.activeHunk = -1;
    void this.revealPosition();
  }

  private setCollapsed(path: string, isCollapsed: boolean): void {
    const without = (paths: ReadonlySet<string>): ReadonlySet<string> => {
      return new Set([...paths].filter((entry) => entry !== path));
    };
    if (isCollapsed) {
      this.expandedPaths = without(this.expandedPaths);
      this.collapsedPaths = new Set([...this.collapsedPaths, path]);
    } else {
      this.expandedPaths = new Set([...this.expandedPaths, path]);
      this.collapsedPaths = without(this.collapsedPaths);
    }
  }

  private runFind(): void {
    this.findMatches = findInReview(this.shownFiles(), this.findQuery, {
      isCaseSensitive: this.isFindCaseSensitive,
    });
    this.findIndex = -1;
  }

  /** Reveals hit `index` through the same jump as a citation: its card loads, then the line. */
  private showMatch(index: number): void {
    const match = this.findMatches[index];
    this.findIndex = -1;
    if (match === undefined) {
      return;
    }
    this.findIndex = index;
    this.activeIndex = match.fileIndex;
    this.activeHunk = -1;
    void this.revealRange(match.fileIndex, {
      start: match.line,
      end: match.line,
      side: match.side,
    });
  }

  /** Space: loads a collapsed card's diff, or collapses an open one, and shows its header. */
  private toggleCollapsed(index: number): void {
    const file = this.shownFiles()[index];
    if (file === undefined || file.hunks.length === 0) {
      return;
    }
    this.setCollapsed(file.path, !this.isCollapsed(file));
    this.activeHunk = -1;
    void this.revealPosition();
  }

  /**
   * The card at `index`, its diff loaded first when it is collapsed: every jump to a line or hunk
   * (citations, the dock, the palette, find) goes through here.
   */
  private async loadedCard(index: number): Promise<BeuveFileCard | undefined> {
    const file = this.shownFiles()[index];
    if (file !== undefined && this.isCollapsed(file)) {
      this.setCollapsed(file.path, false);
    }
    await this.updateComplete;
    const card = this.cards()[index];
    await card?.updateComplete;
    return card;
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
    const loaded = await this.loadedCard(this.activeIndex);
    await loaded?.revealHunk(this.activeHunk);
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
    const index = this.shownFiles().findIndex((file) => file.path === path);
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
      void this.revealRange(index, { start: line, end: jump.endLine, side: jump.side ?? 'head' });
      return;
    }
    void this.loadedCard(index).then(async (card) => card?.focusLine(line));
  }

  private async revealRange(index: number, lines: SideLines): Promise<void> {
    const card = await this.loadedCard(index);
    await card?.revealRange(lines);
  }

  /** Open in Editor: asks the shell to open the active card's file in the editor at the cursor line. */
  private openInEditor(): void {
    const target = this.target();
    if (target.kind === 'change') {
      return;
    }
    this.dispatchEvent(
      new CustomEvent('beuve-open-editor', {
        detail: { path: target.file.path, line: lineFromTarget(target) ?? 1 },
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

  /** Suggest Edit: edits the target's lines, or the staged note under them, on the active card. */
  private editActive(): void {
    const { review } = this;
    let target: EditTarget | undefined;
    if (review !== undefined) {
      target = editTargetFrom(this.target(), this.uraItems, review.headSha);
    }
    if (target === undefined) {
      this.notify(
        'info',
        'Pick a hunk with Next Change, or select head lines, to suggest an edit.',
      );
      return;
    }
    void this.loadedCard(this.activeIndex).then(async (loaded) => loaded?.startEdit(target));
  }

  /** The dock asked to (re-)edit an item's suggestion: its file, its lines, attached to it. */
  private async editItem(itemId: string): Promise<void> {
    const item = this.uraItems.find((entry) => entry.id === itemId);
    let anchor: UraAnchorView | undefined;
    if (item?.placement.kind === 'current') {
      anchor = item.placement.anchor;
    }
    let index = -1;
    if (anchor?.kind === 'lines') {
      const { path } = anchor;
      index = this.shownFiles().findIndex((file) => file.path === path);
    }
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
    const card = await this.loadedCard(index);
    const target: EditTarget = {
      path: anchor.path,
      startLine: anchor.startLine,
      endLine: anchor.endLine,
      itemId,
      ...(item.suggestedPatch !== undefined && { patch: item.suggestedPatch }),
    };
    await card?.startEdit(target);
  }

  /**
   * Add Note: a composer on the active card, staging the target's head lines (ADR 0063), or `anchor`
   * with the suggestion an Suggest Edit edit produced, or the staged note it edits.
   */
  private openComposer(given?: UraAnchorView, options: ComposerOptions = {}): void {
    const { suggestedPatch, edit } = options;
    const { review } = this;
    const files = this.shownFiles();
    if (given !== undefined && given.kind !== 'change') {
      const index = files.findIndex((candidate) => candidate.path === given.path);
      if (index !== -1) {
        this.activeIndex = index;
      }
    }
    const file = files[this.activeIndex];
    if (review === undefined || file === undefined) {
      return;
    }
    const anchor = given ?? anchorFromTarget(this.target());
    const where = describeUraItem({
      id: '',
      sessionId: review.session.id,
      headSha: review.headSha,
      anchor,
      placement: { kind: 'current', anchor },
      severity: 'issue',
      blocking: false,
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
      ...(edit !== undefined && { edit }),
    };
    void this.revealComposer(anchor);
  }

  /** Edits staged note `itemId` in a composer that takes its marker's place (ADR 0129). */
  private editNote(itemId: string): void {
    const item = this.uraItems.find((candidate) => candidate.id === itemId);
    if (item === undefined) {
      return;
    }
    const edit = noteEditFrom(item);
    if (edit === undefined) {
      return;
    }
    this.openComposer(edit.anchor, {
      edit,
      ...(edit.suggestedPatch !== undefined && { suggestedPatch: edit.suggestedPatch }),
    });
  }

  /** Saves the edited note through `ura:update`, as the dock's editor does, and closes the composer. */
  private saveEdit(edit: NoteEdit, draft: UraDraft): void {
    const detail: UpdateUraItemRequest = {
      itemId: edit.itemId,
      severity: draft.severity,
      blocking: draft.blocking,
      title: draft.title,
      body: draft.body,
    };
    this.dispatchEvent(
      new CustomEvent('beuve-ura-update', { detail, bubbles: true, composed: true }),
    );
    this.closeComposer();
  }

  /** A note withdrawn, addressed or outdated while its composer is open closes the composer. */
  private keepEditedNote(): void {
    const itemId = this.composer?.edit?.itemId;
    if (itemId === undefined) {
      return;
    }
    const item = this.uraItems.find((candidate) => candidate.id === itemId);
    if (item === undefined || noteEditFrom(item) === undefined) {
      this.composer = undefined;
    }
  }

  private async revealComposer(anchor: UraAnchorView): Promise<void> {
    const card = await this.loadedCard(this.activeIndex);
    if (anchor.kind === 'lines') {
      await card?.revealLine(anchor.endLine);
    } else {
      await card?.revealLine(undefined);
    }
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

  /** Show Callers toggles the call-stack peek of the active card; Escape closes whichever portal is open. */
  private togglePeek(isClosing: boolean): void {
    const file = this.shownFiles()[this.activeIndex];
    if (isClosing || file === undefined || this.peek?.path === file.path) {
      this.closePortals();
      return;
    }
    this.dispatchEvent(
      new CustomEvent('beuve-peek-request', {
        detail: { path: file.path, line: this.targetLine() },
        bubbles: true,
        composed: true,
      }),
    );
    this.focus();
  }

  /** Show Control Flow toggles the control-flow graph of the function around the same line Show Callers targets. */
  private toggleFlow(): void {
    const file = this.shownFiles()[this.activeIndex];
    if (file === undefined || this.flow?.path === file.path) {
      this.closePortals();
      return;
    }
    this.dispatchEvent(
      new CustomEvent('beuve-flow-request', {
        detail: { path: file.path, line: this.targetLine() },
        bubbles: true,
        composed: true,
      }),
    );
    this.focus();
  }

  /** The head line Show Callers and Show Control Flow find the enclosing function of. */
  private targetLine(): number | undefined {
    return lineFromTarget(this.target());
  }

  private closePortals(): void {
    if (this.peek !== undefined) {
      this.dispatchEvent(new CustomEvent('beuve-peek-close', { bubbles: true, composed: true }));
    }
    if (this.flow !== undefined) {
      this.dispatchEvent(new CustomEvent('beuve-flow-close', { bubbles: true, composed: true }));
    }
    this.focus();
  }

  private renderWelcome(): TemplateResult {
    if (this.loading && this.error === '') {
      return html`
        <div class="body welcome">
          <div class="opening" role="status" aria-live="polite">
            <span class="opening-label">${this.loadingLabel}</span>
            <span class="opening-bar" aria-hidden="true"></span>
            <span class="note">Opening review…</span>
          </div>
        </div>
      `;
    }
    return html`
      <div class="body welcome">
        <div>
          <h1>No review session open</h1>
          <p>Open a local repository or pick a session in the Intent sidebar.</p>
          <span class="note ${this.error === '' ? '' : 'error'}"
            >${this.loading ? 'Loading review…' : this.error || this.sessionNote}</span
          >
        </div>
      </div>
    `;
  }

  private refreshSlices(): void {
    const { slices, uraItems, insights } = this;
    let { insightsByPath, uraItemsByPath } = slices;
    if (slices.insights !== insights) {
      insightsByPath = groupStable(insights, insightPaths, slices.insightsByPath);
    }
    if (slices.uraItems !== uraItems) {
      uraItemsByPath = groupStable(uraItems, uraItemPaths, slices.uraItemsByPath);
    }
    this.slices = { insights, insightsByPath, uraItems, uraItemsByPath };
  }

  /**
   * Save Progress records a checkpoint of the reviewed base and head (ADR 0009, 0068); once the
   * head is saved the button gives way to a quiet note of what was saved and when.
   */
  private renderSaveProgress(review: ReviewView, isUpToDate: boolean): TemplateResult {
    const saved = this.savedProgress;
    let savedSha: string | undefined;
    if (saved?.sha === review.headSha) {
      savedSha = saved.sha;
    } else if (isUpToDate) {
      savedSha = review.session.lastReviewedSha;
    }
    if (savedSha !== undefined && !this.marking) {
      let time: TemplateResult | typeof nothing = nothing;
      if (saved?.sha === savedSha) {
        time = html` ·
          <beuve-time datetime=${saved.at.toString()} time-style="short"></beuve-time>`;
      }
      return html`<span class="saved" title="Next time, show only what changed since this point"
        >Progress saved · <beuve-commit sha=${savedSha}></beuve-commit>${time}</span
      >`;
    }
    return html`<button
      class="button primary large"
      type="button"
      title=${`Save Progress (${this.shortcut('save-progress')}): next time, show only what changed since this point`}
      ?disabled=${this.marking || this.loading}
      @click=${this.onMarkClick}
    >
      ${this.marking ? 'Saving…' : 'Save Progress'}
    </button>`;
  }

  private shortcut(id: CommandId): string {
    return shortcutOf(id, keyPlatformOf(this.platform));
  }

  private renderReview(review: ReviewView): TemplateResult {
    this.refreshSlices();
    const { uraItemsByPath, insightsByPath } = this.slices;
    const plan = this.plan();
    const additions = review.files.reduce((sum, file) => {
      return sum + file.additions;
    }, 0);
    const deletions = review.files.reduce((sum, file) => {
      return sum + file.deletions;
    }, 0);
    const isUpToDate = review.scope.kind === 'up-to-date';
    return html`
      <div class="summary">
        <span class="scope ${review.scope.kind}">${describeReviewScope(review.scope)}</span>
        <span class="range" title=${rangeTitle(review)}>
          ${this.renderCommit(rangeStartOf(review))}..${this.renderCommit(review.headSha)}
        </span>
        <span class="counts"
          >${review.files.length} ${review.files.length === 1 ? 'file' : 'files'} +${additions}
          −${deletions}</span
        >
        ${this.renderProgress()}
        <span class="spacer"></span>
        ${this.renderOrder()} ${this.renderDisplay()}
        ${this.error === '' ? nothing : html`<span class="note error">${this.error}</span>`}
        ${this.renderSaveProgress(review, isUpToDate)}
      </div>
      ${
        this.isFindOpen
          ? html`<beuve-find-bar
              .query=${this.findQuery}
              .isCaseSensitive=${this.isFindCaseSensitive}
              .count=${this.findMatches.length}
              .current=${this.findIndex}
              .isCapped=${this.findMatches.length >= findLimit}
              .shortcuts=${{
                next: this.shortcut('find-next'),
                previous: this.shortcut('find-previous'),
                matchCase: this.shortcut('find-match-case'),
              }}
            ></beuve-find-bar>`
          : nothing
      }
      <div
        class="body"
        @wheel=${this.scrollIntent}
        @touchmove=${this.scrollIntent}
        @pointerdown=${this.onBodyPointerDown}
        @scrollend=${this.onScrollEnd}
      >
        ${
          isUpToDate
            ? html`<p class="empty">Everything up to the head has been reviewed.</p>`
            : html`${this.renderPairs(review)}
                <div class="cards">
                  ${repeat(
                    plan.files,
                    (file) => {
                      return file.path;
                    },
                    (file, index) => {
                      return html`${this.renderGroupLabel(plan, index)}<beuve-file-card
                          .file=${file}
                          .diffStyle=${planDiffLayout(file.status, this.display.layout, this.streamWidth).style}
                          .loadFilePair=${this.loadFilePair}
                          .loadImage=${this.loadImage}
                          .activeHunk=${index === this.activeIndex ? this.activeHunk : -1}
                          .peek=${this.peek?.path === file.path ? this.peek : undefined}
                          .flow=${this.flow?.path === file.path ? this.flow : undefined}
                          .uraItems=${uraItemsByPath.get(file.path) ?? noUraItems}
                          .insights=${insightsByPath.get(file.path) ?? noInsights}
                          .diagnostics=${this.diagnostics.get(file.path)}
                          .composer=${this.composer?.path === file.path ? this.composer : undefined}
                          .deferral=${this.deferrals.get(file.path)}
                          ?collapsed=${this.isCollapsed(file)}
                          .reviewed=${this.reviewMarks.get(file.path) ?? 'no'}
                          ?generated=${isGenerated(this.deferrals.get(file.path))}
                          ?active=${index === this.activeIndex}
                          data-action="card"
                          data-index=${index}
                        ></beuve-file-card>`;
                    },
                  )}
                </div>`
        }
      </div>
    `;
  }

  /** A short sha that opens its commit on the remote (ADR 0108). */
  private renderCommit(sha: string): TemplateResult {
    return html`<beuve-commit
      class="commit"
      sha=${sha}
      abbreviation="8"
      hint="Click to open on GitHub"
      data-action="open-commit"
      data-sha=${sha}
    ></beuve-commit>`;
  }

  private renderProgress(): TemplateResult | typeof nothing {
    const line = describeReviewProgress(this.reviewProgress);
    if (line === undefined) {
      return nothing;
    }
    return html`<span class="progress" title=${line.title}>${line.text}</span>`;
  }

  /** A sort button whose menu lists Path / Imports / Calls (ADR 0065, 0107). */
  private renderOrder(): TemplateResult {
    const requested = this.display.reviewOrder ?? 'path';
    let order = this.order;
    if (order?.headSha !== this.review?.headSha) {
      order = undefined;
    }
    const fallback = describeOrderFallback(order);
    const help = 'The order files are listed in; config and mechanical files go last (/order)';
    const current = orderModes.find(({ mode }) => mode === requested)?.label ?? 'Path';
    return html`<span class="order ${fallback === undefined ? '' : 'fell-back'}"
      ><beuve-menu label="File order">
        <button
          slot="trigger"
          type="button"
          class="button quiet order-button"
          tabindex="-1"
          aria-label="File order: ${current}"
          title=${fallback === undefined ? help : `${fallback}. ${help}`}
        >
          ${displayIcon('sort')}<span>${current}</span>${displayIcon('chevron')}
        </button>
        ${orderModes.map(({ mode, label }) => {
          return html`<button
            type="button"
            role="menuitemradio"
            tabindex="-1"
            aria-checked=${mode === requested ? 'true' : 'false'}
            data-action="order"
            data-mode=${mode}
          >
            ${displayIcon('check')}${label}
          </button>`;
        })}
      </beuve-menu></span
    >`;
  }

  private chooseOrder(mode: ReviewOrderMode): void {
    if (mode !== (this.display.reviewOrder ?? 'path')) {
      this.changeDisplay({ reviewOrder: mode });
    }
  }

  private changeDisplay(change: Partial<DiffDisplayView>): void {
    this.dispatchEvent(
      new CustomEvent('beuve-display-change', {
        detail: change,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private renderGroupLabel(plan: ReviewStreamPlan, index: number): TemplateResult | typeof nothing {
    const label = plan.groupLabels.get(index);
    if (label === undefined) {
      return nothing;
    }
    return html`<div class="group">${label}</div>`;
  }

  /** An interdiff's commits paired with the reviewed ones (ADR 0054), folded until asked for. */
  private renderPairs(review: ReviewView): TemplateResult | typeof nothing {
    const pairs = review.commitPairs ?? [];
    if (pairs.length === 0) {
      return nothing;
    }
    const changed = pairs.filter((pair) => pair.kind !== 'unchanged').length;
    const filtered = pairs.find((pair) => pair.id === this.pairFilter);
    return html`<details class="pairs" ?open=${this.isPairsOpen} @toggle=${this.onPairsToggle}>
      <summary>
        <span>Commits since the last review: ${changed} of ${pairs.length} changed</span>
        ${
          filtered === undefined
            ? nothing
            : html`<span class="filtered">showing “${filtered.subject}”</span>
                <button
                  class="button link"
                  type="button"
                  @click=${(event: Event): void => {
                    event.preventDefault();
                    this.pairFilter = undefined;
                  }}
                >
                  Show all
                </button>`
        }
      </summary>
      <beuve-commit-pairing
        headless
        .pairs=${pairs}
        .selectedId=${this.pairFilter}
        @beuve-commit-pair-filter=${this.onPairFilter}
      ></beuve-commit-pairing>
    </details>`;
  }

  private renderDisplay(): TemplateResult {
    const isNarrow = this.streamWidth !== undefined && this.streamWidth < minimumSplitWidth;
    const label = describeDiffDisplay(this.display, isNarrow);
    const { layout, ignoreWhitespace } = this.display;
    return html`<span class="tools" role="group" aria-label="Diff display" title=${label.title}>
      <span class="segmented" role="radiogroup" aria-label="Diff layout">
        <button
          type="button"
          role="radio"
          tabindex="-1"
          aria-label="Split"
          title="Split"
          aria-checked=${layout === 'split' ? 'true' : 'false'}
          data-action="layout"
          data-layout="split"
        >
          ${displayIcon('split')}
        </button>
        <button
          class=${isNarrow && layout === 'split' ? 'effective' : ''}
          type="button"
          role="radio"
          tabindex="-1"
          aria-label="Inline"
          title="Inline"
          aria-checked=${layout === 'split' ? 'false' : 'true'}
          data-action="layout"
          data-layout="unified"
        >
          ${displayIcon('inline')}
        </button>
      </span>
      <button
        class="button quiet"
        type="button"
        tabindex="-1"
        aria-label="Hide whitespace changes"
        aria-pressed=${ignoreWhitespace ? 'true' : 'false'}
        title=${ignoreWhitespace ? 'Whitespace-only changes are hidden' : 'Hide whitespace-only changes'}
        data-action="whitespace"
      >
        ${displayIcon('whitespace')}
      </button>
    </span>`;
  }

  /**
   * Keeps the cursor on its file when the list changes under it: the same head again (whitespace
   * toggled), a new order, or a commit pair filter. A new head starts at the top.
   */
  private keepCursor(changed: PropertyValues<this>): void {
    const activePath = this.planCache?.plan.files[this.activeIndex]?.path;
    const previous = changed.get('review');
    const isSameHead = !changed.has('review') || previous?.headSha === this.review?.headSha;
    const files = this.shownFiles();
    // A cursor still at the top (nothing stepped to yet) stays at the top of the new order.
    const isAtTop = this.activeIndex === 0 && this.activeHunk === -1;
    let kept = -1;
    if (isSameHead && !isAtTop) {
      kept = files.findIndex((file) => file.path === activePath);
    }
    if (kept === this.activeIndex && !changed.has('review') && !changed.has('pairFilter')) {
      return;
    }
    this.activeIndex = Math.max(0, kept);
    this.activeHunk = -1;
  }

  /** Opens the commit pairs and focuses their list (the palette's command). */
  async openCommitPairs(): Promise<boolean> {
    if ((this.review?.commitPairs ?? []).length === 0) {
      return false;
    }
    this.isPairsOpen = true;
    await this.updateComplete;
    const pairing = this.renderRoot.querySelector('beuve-commit-pairing');
    await pairing?.updateComplete;
    pairing?.renderRoot.querySelector<HTMLElement>('ol')?.focus();
    return true;
  }

  /** Makes `card` the active one, for a context menu opened on it. */
  activateCard(card: HTMLElement): void {
    const index = [...this.cards()].indexOf(card as BeuveFileCard);
    if (index === -1 || index === this.activeIndex) {
      return;
    }

    this.activeIndex = index;
    this.activeHunk = -1;
  }

  /**
   * Runs a menu command on the diff (ADR 0068); true when it was the stream's. Next and Previous
   * Change walk hunks across files, a collapsed card being one stop at its header; Next and Previous
   * File walk headers; both pass reviewed files when Skip Reviewed Files is on.
   */
  runCommand(id: CommandId): boolean {
    switch (id) {
      case 'next-hunk': {
        this.step(1, false);
        return true;
      }
      case 'previous-hunk': {
        this.step(-1, false);
        return true;
      }
      case 'next-file': {
        this.step(1, true);
        return true;
      }
      case 'previous-file': {
        this.step(-1, true);
        return true;
      }
      case 'expand':
      case 'collapse': {
        const file = this.shownFiles()[this.activeIndex];
        if (file !== undefined && this.isCollapsed(file) === (id === 'expand')) {
          this.toggleCollapsed(this.activeIndex);
        }
        return true;
      }
      case 'peek': {
        this.togglePeek(false);
        return true;
      }
      case 'flow': {
        this.toggleFlow();
        return true;
      }
      case 'stage': {
        this.openComposer();
        return true;
      }
      case 'suggest-edit': {
        this.editActive();
        return true;
      }
      case 'open-in-editor': {
        this.openInEditor();
        return true;
      }
      case 'toggle-reviewed': {
        this.toggleReviewed();
        return true;
      }
      case 'toggle-rendered': {
        this.cards()[this.activeIndex]?.toggleView();
        return true;
      }
      case 'find-next': {
        this.findStep(1);
        return true;
      }
      case 'find-previous': {
        this.findStep(-1);
        return true;
      }
      case 'find-selection': {
        const selected = getSelection()?.toString().trim() ?? '';
        if (selected !== '' && !selected.includes('\n')) {
          this.findQuery = selected;
          this.runFind();
          this.showMatch(0);
        }
        void this.openFind();
        return true;
      }
      case 'find-match-case': {
        this.isFindCaseSensitive = !this.isFindCaseSensitive;
        this.runFind();
        return true;
      }
      default: {
        return false;
      }
    }
  }

  /** ⌘F / Ctrl+F: opens the find bar (or focuses it again) over this review. */
  async openFind(): Promise<void> {
    if (this.review === undefined) {
      return;
    }
    this.isFindOpen = true;
    await this.updateComplete;
    this.renderRoot.querySelector<BeuveFindBar>('beuve-find-bar')?.focusInput();
  }

  /** What the reviewer points at (ADR 0063): the active card's target, else the whole change. */
  target(): ReviewTarget {
    return this.cards()[this.activeIndex]?.target() ?? { kind: 'change' };
  }

  /** The active card's last clicked head-side token, which Go to Definition asks about. */
  tokenClicked(): ClickedToken | undefined {
    return this.cards()[this.activeIndex]?.tokenClicked();
  }

  /** What Add to Chat adds to the chat (ADR 0046): the target's lines, or its file. */
  chatMention(): MentionTarget | undefined {
    return mentionFromTarget(this.target());
  }

  override render(): TemplateResult {
    return html`
      ${this.review === undefined ? this.renderWelcome() : this.renderReview(this.review)}
    `;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    const isReviewChanged = changed.has('review');
    const pairs = this.review?.commitPairs ?? [];
    if (isReviewChanged && pairs.every((pair) => pair.id !== this.pairFilter)) {
      this.pairFilter = undefined;
    }
    const isListChanged = isReviewChanged || changed.has('order') || changed.has('pairFilter');
    if (isListChanged) {
      this.keepCursor(changed);
    }
    const previousMarks = changed.get('reviewMarks');
    if (previousMarks !== undefined) {
      this.applyMarkChanges(previousMarks);
    }
    if (changed.has('uraItems')) {
      this.keepEditedNote();
    }
    if (!isReviewChanged) {
      return;
    }
    const previous = changed.get('review');
    if (previous?.session.id !== this.review?.session.id) {
      this.expandedPaths = noPaths;
      this.collapsedPaths = noPaths;
    }
    if (this.isFindOpen) {
      this.runFind();
    }
    const path = this.composer?.path;
    if (this.shownFiles().every((file) => file.path !== path)) {
      this.composer = undefined;
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has('review') || changed.has('order') || changed.has('pairFilter')) {
      void this.observeCards();
    }
    if (
      changed.has('review') ||
      changed.has('activeIndex') ||
      changed.has('order') ||
      changed.has('pairFilter')
    ) {
      this.dispatchEvent(
        new CustomEvent('beuve-active-file', {
          detail: { path: this.shownFiles()[this.activeIndex]?.path },
          bubbles: true,
          composed: true,
        }),
      );
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

function isGenerated(deferral: DiffDeferral | undefined): boolean {
  return deferral?.reason === 'generated' || deferral?.reason === 'no-diff';
}

/**
 * The files a URA item concerns: where it was written and where it sits now. A card reads both
 * (its markers follow the placement).
 */
function uraItemPaths(item: UraItemView): string[] {
  const anchors = [item.anchor];
  if (item.placement.kind === 'current') {
    anchors.push(item.placement.anchor);
  }
  const paths: string[] = [];
  for (const anchor of anchors) {
    if (anchor.kind !== 'change') {
      paths.push(anchor.path);
    }
  }
  return paths;
}

function insightPaths(insight: ReviewInsight): string[] {
  return [insight.finding.path];
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

/** The commits the diff spans: fork point to head, or last reviewed head to head. */
function rangeStartOf(review: ReviewView): string {
  if (review.scope.kind === 'interdiff') {
    return review.scope.fromHeadSha;
  }
  return review.baseSha;
}

function rangeTitle(review: ReviewView): string {
  if (review.scope.kind === 'interdiff') {
    return `Changes since reviewed head ${review.scope.fromHeadSha}, now at ${review.headSha} (forked from ${review.baseSha})`;
  }
  return `${review.baseSha}..${review.headSha}`;
}

/** Runs a card's own action for an event the stream's delegated listener caught on it. */
function forwardToCard(_data: unknown, event: Event, card: HTMLElement): void {
  (card as BeuveFileCard).runAction(event);
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-diff-stream': BeuveDiffStream;
  }
}
