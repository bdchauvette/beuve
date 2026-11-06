import type * as Diffs from '@pierre/diffs';
import type {
  FileDiff,
  FileDiffLoadedFiles,
  FileDiffMetadata,
  OnTokenEventProps,
} from '@pierre/diffs';
import type * as DiffsEdit from '@pierre/diffs/edit';
import type { Editor } from '@pierre/diffs/edit';
import type * as DiffsWorker from '@pierre/diffs/worker';
import type { WorkerPoolManager } from '@pierre/diffs/worker';
import { css, html, LitElement, nothing, svg } from 'lit';
import type { PropertyValues, SVGTemplateResult, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { keyed } from 'lit/directives/keyed.js';
import { styleMap } from 'lit/directives/style-map.js';

import type {
  DiffFileView,
  DiffLayoutView,
  FileReviewStateView,
  FilePairView,
  UraAnchorView,
  UraItemView,
} from '#contract/ipc-contract.ts';
import { revealFormatControls } from '#x/text/reveal-format-controls.ts';

import './beuve-flow-portal.ts';
import type { FlowNodeActivateDetail } from './flow-graph-view.ts';
import './beuve-peek-portal.ts';
import './beuve-ura-composer.ts';
import type { BeuveUraComposer } from './beuve-ura-composer.ts';
import { applySuggestedPatch } from './apply-suggested-patch.ts';
import { buildSuggestedPatch } from './build-suggested-patch.ts';
import { describeUraItem } from './describe-ura-item.ts';
import { describeDiagnostics } from './describe-diagnostics.ts';
import { DiagnosticHighlights } from './diagnostic-highlights.ts';
import { diagnosticRangesFrom } from './diagnostic-ranges-from.ts';
import type { DiagnosticsWantedDetail, FileDiagnostics } from './file-diagnostics.ts';
import { headRowSelector } from './head-row-selector.ts';
import { characterOffsetAt } from './character-offset-at.ts';
import type { HoverPoint } from './hover-point.ts';
import { highlightedLanguages } from './highlighted-languages.ts';
import type { ClickedToken } from './run-sheet-action.ts';
import type { FlowState } from './flow-state.ts';
import type { PeekState } from './peek-state.ts';
import { editTargetFrom } from './edit-target-from.ts';
import type { EditTarget } from './edit-target-from.ts';
import { planHunkSteps } from './plan-hunk-steps.ts';
import { planStepHighlight } from './plan-step-highlight.ts';
import type { HunkStep } from './plan-hunk-steps.ts';
import type { DiffDeferral } from './plan-diff-deferrals.ts';
import { targetFrom } from './target-from.ts';
import type { ReviewTarget, SelectedLines } from './target-from.ts';
import { splitPatch } from './split-patch.ts';
import { headSideAnnotationsFrom } from './head-side-annotations-from.ts';
import type { PlacedNote } from './head-side-annotations-from.ts';
import { placeNoteOnDiff } from './place-note-on-diff.ts';
import type {
  HeadSideRange,
  HunkExpansion,
  NotePlacement,
  ShownLines,
} from './place-note-on-diff.ts';
import { diffsThemeNames } from './diffs-theme-names.ts';
import { loadDiffsLibrary } from './load-diffs-library.ts';
import { parseInlineTitle } from './parse-inline-title.ts';
import { headlineOfUraItem } from './headline-of-ura-item.ts';
import { anchorFromTarget } from './anchor-from-target.ts';
import { createUraNoteIcon } from './create-ura-note-icon.ts';
import { uraMarkersFrom } from './ura-markers-from.ts';
import { createInlineNode } from './create-inline-node.ts';
import { createInsightElement } from './create-insight-element.ts';
import { delegateActions } from './delegate-actions.ts';
import type { DelegatedActions } from './delegate-actions.ts';
import { dispatchAction } from './dispatch-action.ts';
import type { ActionHandlers } from './dispatch-action.ts';
import { setInsightOpen } from './set-insight-open.ts';
import { describeInsightCount } from './describe-insight-count.ts';
import type { ReviewInsight } from './merge-review-insights.ts';
import { planInsightMarks } from './plan-insight-marks.ts';
import { insightMarkCssFrom } from './insight-mark-css-from.ts';
import { keyPlatformOf } from './key-platform-of.ts';
import { shortcutOf } from './shortcut-of.ts';
import { formatControlStyles } from './format-control-styles.ts';
import { pathText } from './path-text.ts';
import { buttonStyles } from './primitives/button-styles.ts';
import { badgeStyles } from './primitives/badge-styles.ts';
import { emptyStateStyles } from './primitives/empty-state-styles.ts';

/** Reads both sides of a reviewed file for hunk expansion; `undefined` when it can't. */
export type FilePairLoader = (path: string) => Promise<FilePairView | undefined>;

/** The note composer Add Note opened on this card, and how saving it went. */
export interface ComposerState {
  readonly path: string;
  readonly anchor: UraAnchorView;
  readonly where: string;
  readonly saving: boolean;
  readonly error: string;
  /** The suggestion an Suggest Edit edit produced, staged with the note (ADR 0043). */
  readonly suggestedPatch?: string;
}

/**
 * An Suggest Edit edit on this card (ADR 0043): loading the file pair and the editor, editing, or failed
 * to start; `error` is shown in the edit bar (e.g. an edit outside the range).
 */
export interface EditSession {
  readonly target: EditTarget;
  readonly phase: 'loading' | 'editing' | 'failed';
  readonly error: string;
}

/** Sent when an edit is cancelled, with a note for the status bar (`''` for none). */
export interface SuggestionCancelDetail {
  readonly message: string;
}

/** Sent by "Load diff" (or its undo) on a card. */
/** `beuve-token-jump`: ⌘/Ctrl-click on a head-side token, to follow its definition. */
export interface TokenJumpDetail {
  readonly target: ReviewTarget;
  readonly token: ClickedToken | undefined;
}

export interface DiffToggleDetail {
  readonly path: string;
  readonly expand: boolean;
}

/** Lines `start`–`end` of one side of a card's file. */
export interface SideLines {
  readonly start: number;
  readonly end: number;
  readonly side: 'head' | 'base';
}

/** Sent when an Suggest Edit edit is saved: the edited range and its suggested patch. */
export interface SuggestionSaveDetail {
  readonly target: EditTarget;
  readonly patch: string;
}

/** What a card annotates under a head line (or above the diff, at line 0). */
type CardNote =
  | { readonly kind: 'ura'; readonly item: UraItemView }
  | { readonly kind: 'insight'; readonly insight: ReviewInsight }
  | { readonly kind: 'composer' };

/** A note with the head lines it is about; one interface, so the library's metadata type stays whole. */
interface CardSlot {
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly note: CardNote;
}

/** A card note placed on the diff, as the library's annotation metadata. */
type PlacedSlot = PlacedNote<CardSlot>;

/** Context lines a "line N, outside the shown hunks" button revealed, and how. */
interface RevealedRange {
  readonly range: HeadSideRange;
  readonly expansion: HunkExpansion;
}

const noInsights: readonly ReviewInsight[] = [];

/** The `@pierre/diffs` side that holds each side's lines. */
const librarySides = { head: 'additions', base: 'deletions' } as const;

const estimatedLineHeight = 20;
const estimatedSeparatorHeight = 32;

/**
 * One file of the review diff (ADR 0018, 0025): a header with its status, path and line counts,
 * the call-stack peek portal while it is
 * open, and the patch rendered by `@pierre/diffs` with Alabaster-style highlighting. The diff mounts while the stream sets `mounted` (the card is near
 * the viewport); otherwise a placeholder of the diff's last or estimated height stands in. If the
 * library fails to render, the card falls back to a plain `<pre>` of the patch. Staged URA items
 * show as subtle markers under their lines and the Add Note composer opens under the lines it stages.
 */
@customElement('beuve-file-card')
export class BeuveFileCard extends LitElement {
  static override styles = [
    emptyStateStyles,
    badgeStyles,
    buttonStyles,
    formatControlStyles,
    css`
      :host {
        display: block;
        border: var(--beuve-border-width) solid var(--beuve-border);
        border-radius: var(--beuve-radius);
        background: var(--beuve-code-bg);
        overflow: clip;
      }

      :host([active]) {
        border-color: var(--beuve-accent);
        box-shadow: 0 0 0 var(--beuve-border-width) var(--beuve-accent);
      }

      .header {
        position: sticky;
        inset-block-start: calc(-1 * var(--beuve-space-3));
        z-index: 2;
      }

      .title {
        display: flex;
        align-items: center;
        gap: var(--beuve-space-2);
        padding: var(--beuve-space-2) var(--beuve-space-3);
        border-block-end: var(--beuve-border-width) solid var(--beuve-border);
        background: var(--beuve-surface-sunken);
      }

      .path {
        flex: 1;
        min-inline-size: 0;
        overflow: hidden;
        font: var(--beuve-font-mono);
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .old-path {
        color: var(--beuve-text-muted);
      }

      .status {
        text-transform: uppercase;
      }

      .counts {
        display: inline-flex;
        flex: none;
        gap: var(--beuve-space-1);
        justify-content: flex-end;
        min-inline-size: calc(11 * var(--beuve-measure-ch));
        font-variant-numeric: tabular-nums;
      }

      .additions {
        font: var(--beuve-font-mono);
        color: var(--beuve-diff-added-text);
      }

      .deletions {
        font: var(--beuve-font-mono);
        color: var(--beuve-diff-removed-text);
      }

      .edit-bar {
        display: flex;
        align-items: baseline;
        gap: var(--beuve-space-2);
        padding: var(--beuve-space-1) var(--beuve-space-3);
        border-block-end: var(--beuve-border-width) solid var(--beuve-border);
        border-inline-start: var(--beuve-border-width-heavy) solid var(--beuve-accent);
        background: var(--beuve-surface);
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      .edit-bar .what {
        font-weight: var(--beuve-font-weight-semibold);
        color: var(--beuve-text);
      }

      .edit-bar .error {
        color: var(--beuve-danger);
      }

      .placeholder {
        background: var(--beuve-code-bg);
      }

      .tag {
        flex: 0 1 auto;
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        padding: 0 var(--beuve-space-1);
        border-radius: var(--beuve-radius-small);
        background: var(--beuve-surface);
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      :host([generated][collapsed]) .title {
        opacity: 0.6;
      }

      :host([generated][collapsed][active]) .title {
        opacity: 0.85;
      }

      .reviewed-mark {
        display: inline-flex;
        flex: none;
        inline-size: var(--beuve-size-icon-small);
        block-size: var(--beuve-size-icon-small);
        padding: 0;
        border: none;
        background: none;
        color: var(--beuve-ok);
        cursor: pointer;
      }

      .reviewed-mark svg {
        inline-size: 100%;
        block-size: 100%;
      }

      :host([reviewed='yes'][collapsed]) .title {
        cursor: pointer;
      }

      .changed-since {
        flex: 0 1 auto;
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        padding: 0 var(--beuve-space-1);
        border: var(--beuve-border-width) dashed var(--beuve-border);
        border-radius: var(--beuve-radius-small);
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      :host([reviewed='yes'][collapsed]) .title {
        border-block-end-color: transparent;
      }

      :host([reviewed='yes'][collapsed]:not([active])) .path,
      :host([reviewed='yes'][collapsed]:not([active])) .status {
        color: var(--beuve-text-muted);
      }

      .collapsed-body {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--beuve-space-2);
        padding: var(--beuve-space-2) var(--beuve-space-3);
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      .collapsed-body .size {
        font-variant-numeric: tabular-nums;
      }

      .empty {
        padding: var(--beuve-space-2) var(--beuve-space-3);
        font: var(--beuve-font-small);
      }

      diffs-container {
        --diffs-font-family: var(--beuve-font-family-mono);
        --diffs-font-size: var(--beuve-font-size-code);
        --diffs-line-height: var(--beuve-line-height-code);
        --diffs-header-font-family: var(--beuve-font-family-sans);
        --diffs-bg-context-override: var(--beuve-code-bg);
        --diffs-bg-buffer-override: var(--beuve-code-bg);
        --diffs-bg-separator-override: var(--beuve-surface-sunken);
        --diffs-bg-context-gutter-override: var(--beuve-code-bg);
        --diffs-fg-number-override: var(--beuve-text-muted);
        --diffs-bg-addition-override: var(--beuve-diff-added-bg);
        --diffs-bg-addition-number-override: var(--beuve-diff-added-number-bg);
        --diffs-bg-addition-emphasis-override: var(--beuve-diff-added-emphasis);
        --diffs-bg-deletion-override: var(--beuve-diff-removed-bg);
        --diffs-bg-deletion-number-override: var(--beuve-diff-removed-number-bg);
        --diffs-bg-deletion-emphasis-override: var(--beuve-diff-removed-emphasis);
        --diffs-addition-color-override: var(--beuve-diff-added-bar);
        --diffs-deletion-color-override: var(--beuve-diff-removed-bar);
        --diffs-bg-selection-override: var(--beuve-accent-soft);
        --diffs-bg-selection-number-override: var(--beuve-accent-soft);
        --diffs-selection-color-override: var(--beuve-accent);
        --diffs-bg-hover-override: var(--beuve-surface-sunken);
      }

      .ura-marker {
        display: flex;
        align-items: baseline;
        gap: var(--beuve-space-2);
        margin: var(--beuve-space-0-5) var(--beuve-space-3);
        padding: 0 var(--beuve-space-2);
        border-inline-start: var(--beuve-border-width-thick) solid var(--beuve-accent);
        font: var(--beuve-font-small);
        white-space: nowrap;
        color: var(--beuve-text-muted);
      }

      .ura-marker .ura-kind {
        display: inline-flex;
        flex: none;
        align-items: center;
        gap: var(--beuve-space-1);
        font-weight: var(--beuve-font-weight-semibold);
        color: var(--beuve-accent);
      }

      .ura-marker.blocker {
        border-inline-start-color: var(--beuve-danger);
      }

      .ura-marker.blocker .ura-kind {
        color: var(--beuve-danger);
      }

      .ura-marker .ura-title {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        color: var(--beuve-text);
      }

      .ura-marker .ura-outside {
        flex: none;
        margin-inline-start: auto;
        padding: 0 var(--beuve-space-1);
        border: none;
        border-radius: var(--beuve-radius-small);
        background: none;
        font: inherit;
        color: var(--beuve-accent);
        cursor: pointer;
      }

      .ura-marker .ura-outside:hover {
        text-decoration: underline;
      }

      .ura-marker .ura-outside:focus-visible {
        outline: var(--beuve-border-width) solid var(--beuve-accent);
        outline-offset: var(--beuve-focus-ring-offset);
      }

      .ura-marker .ura-title code {
        padding: 0 var(--beuve-space-0-5);
        border-radius: var(--beuve-radius-small);
        background: var(--beuve-surface-sunken);
        font: var(--beuve-font-mono);
      }

      .insight-badge {
        color: var(--beuve-text-muted);
      }

      .diagnostics-note.error {
        color: var(--beuve-danger);
      }

      .diagnostics-note.warning {
        color: var(--beuve-warn);
      }

      .insight {
        --insight-color: var(--beuve-text-muted);
        margin: var(--beuve-space-0-5) var(--beuve-space-3);
        padding: 0 var(--beuve-space-2);
        border-inline-start: var(--beuve-border-width-thick) solid var(--insight-color);
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      .insight.risk {
        --insight-color: var(--beuve-danger);
      }

      .insight.warning {
        --insight-color: var(--beuve-warn);
      }

      .insight.unconfirmed {
        opacity: 0.65;
      }

      .insight.unconfirmed.open,
      .insight.unconfirmed:hover {
        opacity: 1;
      }

      .insight-line {
        display: flex;
        align-items: baseline;
        gap: var(--beuve-space-2);
        min-inline-size: 0;
        white-space: nowrap;
        cursor: pointer;
        outline: none;
      }

      .insight-line:focus-visible {
        outline: var(--beuve-border-width) solid var(--beuve-accent);
        outline-offset: var(--beuve-focus-ring-offset);
      }

      .insight-category {
        flex: none;
        color: var(--insight-color);
      }

      .insight-title {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        color: var(--beuve-text);
      }

      .insight.open .insight-title {
        overflow: visible;
        white-space: normal;
      }

      .insight-flag {
        flex: none;
        font-style: italic;
      }

      .insight code {
        padding: 0 var(--beuve-space-0-5);
        border-radius: var(--beuve-radius-small);
        background: var(--beuve-surface-sunken);
        font: var(--beuve-font-mono);
      }

      .insight-body {
        padding: var(--beuve-space-1) 0 var(--beuve-space-2);
        color: var(--beuve-text);
        white-space: normal;
      }

      .insight-text :is(p, ul, ol, blockquote, hr, h1, h2, h3, h4, h5, h6, .table) {
        margin: 0 0 var(--beuve-space-1);
      }

      .insight-text :is(h1, h2, h3, h4, h5, h6) {
        font: inherit;
        font-weight: var(--beuve-font-weight-semibold);
      }

      .insight-text :is(ul, ol) {
        padding-inline-start: var(--beuve-space-4);
      }

      .insight-text .table {
        overflow-inline: auto;
      }

      .insight-text table {
        border-collapse: collapse;
        font: inherit;
      }

      .insight-text :is(th, td) {
        padding: var(--beuve-space-px) var(--beuve-space-2);
        border: var(--beuve-border-width) solid var(--beuve-border);
        text-align: start;
        vertical-align: top;
      }

      .insight-text th {
        background: var(--beuve-surface-sunken);
        font-weight: var(--beuve-font-weight-semibold);
      }

      .insight-text .align-center {
        text-align: center;
      }

      .insight-text .align-right {
        text-align: end;
      }

      .insight-text pre {
        margin: 0 0 var(--beuve-space-1);
        padding: var(--beuve-space-1) var(--beuve-space-2);
        border-radius: var(--beuve-radius-small);
        background: var(--beuve-surface-sunken);
        overflow-inline: auto;
      }

      .insight-actions {
        display: flex;
        align-items: baseline;
        gap: var(--beuve-space-2);
        color: var(--beuve-text-muted);
      }

      pre {
        margin: 0;
        padding: var(--beuve-space-1) 0;
        overflow-inline: auto;
        font: var(--beuve-font-mono);
      }

      .line {
        display: block;
        min-inline-size: max-content;
        padding: 0 var(--beuve-space-3);
      }

      .line.added {
        background: var(--beuve-diff-added-bg);
      }

      .line.removed {
        background: var(--beuve-diff-removed-bg);
      }

      .line.hunk,
      .line.meta,
      .line.note {
        color: var(--beuve-text-muted);
      }
    `,
  ];

  private diff: FileDiff<PlacedSlot> | undefined;
  private metadata: FileDiffMetadata | undefined;
  /** The diff's rendered height when it last unmounted, for an exact placeholder. */
  private measuredHeight: number | undefined;
  /**
   * The mounted diff's height as a `ResizeObserver` last reported it. Unmounting reads this
   * instead of measuring, which would force a layout per card while the stream scrolls (ADR 0050).
   */
  private codeHeight: number | undefined;
  private observedCode: Element | undefined;
  private readonly codeObserver = new ResizeObserver((entries) => {
    const entry = entries.at(-1);
    if (entry !== undefined) {
      this.codeHeight = entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height;
    }
  });
  private composerElement: BeuveUraComposer | undefined;
  /** The step Next/Previous Change last selected, to tell it apart from the reviewer's own selection. */
  private programmaticStep: HunkStep | undefined;
  /** Lines the reviewer selected in the gutter, until Next/Previous Change moves on. */
  private lineSelection: SelectedLines | undefined;
  /** The head-side token last clicked; forgotten when the reviewer selects or steps elsewhere. */
  private clickedToken: ClickedToken | undefined;
  /** The head line a jump (citation or flow node) landed on, until Next/Previous Change moves on. */
  private focusedLine: number | undefined;
  /** The Suggest Edit editor attached to the diff, and the head text it started from. */
  private editor: Editor<'file-diff', PlacedSlot> | undefined;
  private editHead: string | undefined;
  /** Insight notes the reviewer expanded, by insight key. */
  private readonly openInsights = new Set<string>();
  /** The gutter marks' style sheet in this diff's shadow root. */
  private markSheet: CSSStyleSheet | undefined;
  /** Whether this diff's gutter button already shows the chat icon. */
  private isGutterLabelled = false;
  /** Bumped to give the diff a fresh container: after an edit, or a layout change. */
  private codeGeneration = 0;
  /** This card's diagnostic underlines in the document's shared highlights. */
  private readonly diagnosticHighlights = new DiagnosticHighlights();
  /**
   * While editing, ⌘/Ctrl+Enter saves and Escape cancels before the editor sees them; every
   * other key stays with the editor and never reaches the stream's shortcuts.
   */
  private readonly onEditKeyCapture = (event: KeyboardEvent): void => {
    if (this.edit === undefined) {
      return;
    }
    const isSave = event.key === 'Enter' && (event.metaKey || event.ctrlKey);
    if (!isSave && event.key !== 'Escape') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (isSave) {
      this.saveEdit();
    } else {
      this.cancelEdit('');
    }
  };

  private readonly onEditKeyBubble = (event: KeyboardEvent): void => {
    if (this.edit !== undefined) {
      event.stopPropagation();
    }
  };

  private readonly onFlowNodeActivate = (event: CustomEvent<FlowNodeActivateDetail>): void => {
    event.stopPropagation();
    void this.focusLine(event.detail.startLine);
  };

  private readonly onTokenClick = (props: OnTokenEventProps<'diff'>, event: MouseEvent): void => {
    if (props.side === 'deletions') {
      this.clickedToken = undefined;
      return;
    }
    this.clickedToken = {
      line: props.lineNumber,
      character: props.lineCharStart + characterOffsetAt(props.tokenElement, event),
    };
    if (!event.metaKey && !event.ctrlKey) {
      return;
    }
    const detail: TokenJumpDetail = { target: this.target(), token: this.clickedToken };
    this.dispatchEvent(
      new CustomEvent('beuve-token-jump', { detail, bubbles: true, composed: true }),
    );
  };

  /** Head-side tokens only, as for Go to Definition: the checkout the server reads has no deleted text. */
  private readonly onTokenEnter = (props: OnTokenEventProps<'diff'>, event: PointerEvent): void => {
    const path = this.file?.path;
    if (path === undefined || props.side === 'deletions') {
      return;
    }
    const detail: HoverPoint = {
      path,
      line: props.lineNumber,
      lineCharStart: props.lineCharStart,
      tokenElement: props.tokenElement,
      clientX: event.clientX,
      clientY: event.clientY,
    };
    this.dispatchEvent(
      new CustomEvent('beuve-token-hover', { detail, bubbles: true, composed: true }),
    );
  };

  private readonly onTokenLeave = (): void => {
    this.dispatchEvent(new CustomEvent('beuve-token-hover-end', { bubbles: true, composed: true }));
  };

  private readonly onLineSelected = (range: SelectedLines | null): void => {
    this.clickedToken = undefined;
    if (range === null) {
      this.lineSelection = undefined;
      return;
    }
    const step = this.programmaticStep;
    const isStep =
      range.start === step?.start &&
      range.end === step.end &&
      (range.side ?? 'additions') === step.side;
    if (isStep) {
      this.lineSelection = undefined;
      return;
    }
    this.lineSelection = range;
    this.focusedLine = undefined;
  };

  /**
   * The card's actions (ADR 0074), which the diff stream's listeners run through {@link runAction}:
   * a card adds no click or key listener of its own. Focus and hover moves inside a card never
   * reach the stream (their related target is in the same shadow root), so the `crossing` ones
   * are delegated to the card's own root, and only while it shows insights.
   */
  private readonly actions = {
    click: {
      title: (_data, event): void => {
        if (this.collapsed && this.reviewed === 'yes') {
          this.expand(event);
        }
      },
      unmark: (_data, event): void => {
        this.unmark(event);
      },
      expand: (_data, event): void => {
        this.expand(event);
      },
      'reveal-note': ({ uraItemId = '' }, event): void => {
        event.stopPropagation();
        this.revealNote(uraItemId);
      },
      'insight-line': (_data, _event, line): void => {
        this.toggleInsight(line, undefined);
      },
      'insight-stage': (_data, _event, button): void => {
        this.emitInsight(button, 'beuve-insight-stage');
      },
      'insight-show': (_data, _event, button): void => {
        this.emitInsight(button, 'beuve-insight-show-in-chat');
      },
    },
    keydown: {
      insight: (_data, event, note): void => {
        this.onInsightKey(event, note);
      },
    },
  } satisfies DelegatedActions;

  private readonly crossing = {
    focusin: {
      'insight-line': (_data, _event, line): void => {
        if (line.matches(':focus-visible') && line.getAttribute('aria-expanded') !== 'true') {
          this.toggleInsight(line, true);
        }
      },
    },
  } satisfies DelegatedActions;

  /** The {@link crossing} listeners, while the card has something they act on. */
  private crossingDelegation: AbortController | undefined;
  /** The editing keys' listeners, while a Suggest Edit edit is in progress. */
  private editKeys: AbortController | undefined;
  /** The ⌘/Ctrl tracking that shows the pointer on tokens, while the card is in the document. */
  /** Context the reviewer revealed for notes outside the hunks, until the file changes. */
  @state() private accessor revealed: readonly RevealedRange[] = [];

  @property({ attribute: false }) accessor file: DiffFileView | undefined;
  @property({ type: Boolean, reflect: true }) accessor active = false;
  /** Set by the diff stream when the card nears the viewport; the diff renders from then on. */
  @property({ type: Boolean, reflect: true }) accessor mounted = false;
  @property({ attribute: false }) accessor peek: PeekState | undefined;
  /** The control-flow graph portal, which shares the peek's place (one portal at a time). */
  @property({ attribute: false }) accessor flow: FlowState | undefined;
  /** The hunk Next/Previous Change stopped at, selected in the diff; `-1` for none. */
  @property({ type: Number }) accessor activeHunk = -1;
  /** Enables hunk expansion; absent outside Electron. */
  @property({ attribute: false }) accessor loadFilePair: FilePairLoader | undefined;
  /** The session's URA items; staged ones placed on this file get markers. */
  @property({ attribute: false }) accessor uraItems: readonly UraItemView[] = [];
  /** `/review` findings on this file's lines, not yet staged (ADR 0061); empty when hidden. */
  @property({ attribute: false }) accessor insights: readonly ReviewInsight[] = noInsights;
  /** The language servers' diagnostics for this file at the head (ADR 0111); absent until asked. */
  @property({ attribute: false }) accessor diagnostics: FileDiagnostics | undefined;
  /** The Add Note composer, when it is open on this file. */
  @property({ attribute: false }) accessor composer: ComposerState | undefined;
  /** How the diff is laid out ({@link planDiffLayout} in the stream, ADR 0042). */
  @property() accessor diffStyle: DiffLayoutView = 'unified';
  /** Why this file starts collapsed (ADR 0052): generated, a lockfile or too large. */
  @property({ attribute: false }) accessor deferral: DiffDeferral | undefined;
  /**
   * Shows the header and a "Load diff" line instead of the diff, which stays unmounted; the
   * stream decides, from `deferral`, the generated-files preference and Expand or Collapse File.
   */
  @property({ type: Boolean, reflect: true }) accessor collapsed = false;
  /** Generated or `-diff` (ADR 0052): labelled, and dimmed while collapsed. */
  @property({ type: Boolean, reflect: true }) accessor generated = false;
  /**
   * The file's reviewed mark (ADR 0064): a check when `yes` (the stream collapses the card), a
   * quiet "changed since reviewed" tag when its diff moved on since the mark.
   */
  @property({ reflect: true }) accessor reviewed: FileReviewStateView = 'no';

  /** The Suggest Edit edit in progress on this card (ADR 0043). */
  @state() accessor edit: EditSession | undefined;

  @state() accessor isFallback = false;
  /** `@pierre/diffs`, loaded with the first card that mounts (ADR 0025). */
  @state() accessor library: typeof Diffs | undefined;

  constructor() {
    super();
    this.addController({
      hostConnected: (): void => {
        // A card moved in the stream (a new file order) was disconnected, which dropped its diff.
        if (!this.hasUpdated || !this.mounted || this.diff !== undefined) {
          return;
        }
        this.codeGeneration += 1;
        this.requestUpdate();
      },
      hostDisconnected: (): void => {
        this.diagnosticHighlights.clear();
        this.endEdit();
        this.diff?.cleanUp();
        this.diff = undefined;
        this.unobserveCode();
      },
    });
  }

  /** A rendered row by head line (base line for deletions), on the head side when split. */
  private findRow(side: 'additions' | 'deletions' | 'context', line: number): Element | undefined {
    const root = this.renderRoot.querySelector('diffs-container')?.shadowRoot;
    return root?.querySelector(headRowSelector(this.diffStyle, side, line)) ?? undefined;
  }

  private observeCode(container: HTMLElement): void {
    if (this.observedCode === container) {
      return;
    }
    this.codeObserver.disconnect();
    this.codeObserver.observe(container);
    this.observedCode = container;
  }

  private unobserveCode(): void {
    this.codeObserver.disconnect();
    this.observedCode = undefined;
    this.codeHeight = undefined;
  }

  private async loadLibrary(): Promise<void> {
    try {
      this.library = await loadDiffs();
    } catch {
      this.isFallback = true;
    }
  }

  private syncDiff(
    changed: PropertyValues<this>,
    { library, container, metadata }: DiffMount,
  ): void {
    const isNew = this.diff === undefined;
    this.diff ??= this.createDiff(library);
    const annotations = headSideAnnotationsFrom(this.shownLines(), this.notes());
    const isNewInput = [
      'file',
      'mounted',
      'library',
      'uraItems',
      'insights',
      'composer',
      'revealed',
    ].some((key) => {
      return changed.has(key as keyof BeuveFileCard);
    });
    // Only a new diff passes the parsed patch: passing it again would replace the full files an
    // expansion loaded (a new, hydrated diff) and collapse every expanded gap.
    const isNewDiff = isNew || changed.has('file') || changed.has('library');
    if (isNewDiff || isNewInput) {
      this.diff.render({
        ...(isNewDiff && { fileDiff: metadata }),
        containerWrapper: container,
        lineAnnotations: annotations,
      });
    }
    if (isNew) {
      // A new diff starts collapsed: show again what the reviewer revealed for notes.
      for (const { expansion } of this.revealed) {
        this.diff.expandHunk(expansion.gap, expansion.direction, expansion.lines);
      }
    }
    if (!isNew && !changed.has('activeHunk') && !changed.has('active')) {
      return;
    }
    // A click on a line number of another card activates it; the lines it selected stay selected.
    const isActivatedBySelecting =
      !isNew && this.active && this.activeHunk === -1 && this.lineSelection !== undefined;
    if (isActivatedBySelecting) {
      return;
    }
    let step: HunkStep | undefined;
    if (this.active) {
      step = planHunkSteps(metadata.hunks, this.diffStyle)[this.activeHunk];
    }
    this.programmaticStep = step;
    this.lineSelection = undefined;
    // eslint-disable-next-line unicorn/no-null -- the library clears the selection with null.
    this.diff.setSelectedLines(step ?? null, planStepHighlight(this.diffStyle, step));
  }

  /** The head lines the diff shows: its hunks, and the context revealed for notes. */
  private shownLines(): ShownLines {
    return {
      hunks: this.file?.hunks ?? [],
      revealed: this.revealed.map(({ range }) => range),
    };
  }

  /**
   * "line N, outside the shown hunks": expands the collapsed context that holds staged item
   * `itemId`'s lines, as the separator's own buttons would, and moves its marker under them.
   */
  private revealNote(itemId: string): void {
    const marker = uraMarkersFrom(this.file?.path ?? '', this.uraItems).find(({ item }) => {
      return item.id === itemId;
    });
    if (marker === undefined || this.diff === undefined) {
      return;
    }
    const placement = placeNoteOnDiff(this.shownLines(), marker);
    if (placement.kind !== 'hidden') {
      return;
    }
    const { expansion } = placement;
    this.diff.expandHunk(expansion.gap, expansion.direction, expansion.lines);
    const range = { lineStart: marker.lineStart, lineEnd: marker.lineEnd };
    this.revealed = [...this.revealed, { range, expansion }];
  }

  /** Staged URA markers first, then the composer, each under its last line. */
  private notes(): CardSlot[] {
    const path = this.file?.path ?? '';
    const slots: CardSlot[] = [
      ...uraMarkersFrom(path, this.uraItems).map(({ lineStart, lineEnd, item }): CardSlot => {
        return {
          lineStart,
          lineEnd,
          note: { kind: 'ura', item },
        };
      }),
      ...this.insights.map((insight): CardSlot => {
        return {
          lineStart: insight.finding.startLine,
          lineEnd: insight.finding.endLine,
          note: { kind: 'insight', insight },
        };
      }),
    ];
    const { composer } = this;
    if (composer?.path !== path) {
      return slots;
    }
    if (composer.anchor.kind === 'lines') {
      const { startLine, endLine } = composer.anchor;
      slots.push({ lineStart: startLine, lineEnd: endLine, note: { kind: 'composer' } });
    } else {
      slots.push({ lineStart: 0, lineEnd: 0, note: { kind: 'composer' } });
    }
    return slots;
  }

  private createDiff(library: typeof Diffs): FileDiff<PlacedSlot> {
    this.isGutterLabelled = false;
    const loader = this.loadFilePair;
    return new library.FileDiff<PlacedSlot>(
      {
        theme: diffsThemeNames,
        themeType: 'system',
        preferredHighlighter: 'shiki-js',
        diffStyle: this.diffStyle,
        disableFileHeader: true,
        hunkSeparators: 'line-info',
        lineDiffType: 'word-alt',
        overflow: 'scroll',
        enableLineSelection: true,
        onLineSelected: this.onLineSelected,
        onTokenClick: this.onTokenClick,
        onTokenEnter: this.onTokenEnter,
        onTokenLeave: this.onTokenLeave,
        enableGutterUtility: true,
        onGutterUtilityClick: (range): void => {
          this.addNote(range);
        },
        ...(loader !== undefined && {
          loadDiffFiles: async (fileDiff: FileDiffMetadata): Promise<FileDiffLoadedFiles> => {
            return loadFiles(loader, fileDiff);
          },
        }),
        renderAnnotation: (annotation): HTMLElement => {
          return this.noteElement(annotation.metadata);
        },
        onPostRender: (_node, _instance, phase): void => {
          if (phase === 'unmount') {
            this.diagnosticHighlights.clear();
            return;
          }
          if (phase === 'mount') {
            this.syncInsightMarks();
          }
          this.syncDiagnosticHighlights();
        },
      },
      shared.pool,
    );
  }

  /**
   * `@pierre/diffs` shows its gutter button beside the hovered line number, or at the end of the
   * selection; a click opens the note composer on that line or the selection, a drag from it
   * selects lines first (ADR 0101). Its plus becomes the note icon; Add to Chat (⌘>) sends the
   * selected lines to the chat instead.
   */
  private labelGutterButton(): void {
    const root = this.renderRoot.querySelector('diffs-container')?.shadowRoot;
    const button = root?.querySelector<HTMLElement>('[data-utility-button]');
    if (button === undefined || button === null) {
      return;
    }
    this.isGutterLabelled = true;
    button.title = `Add Note (${shortcutOf('stage', keyPlatformOf(navigator.platform))}); drag to take more lines. Add to Chat: ${shortcutOf('add-to-chat', keyPlatformOf(navigator.platform))}`;
    button.setAttribute('aria-label', 'Add a review note on these lines');
    button.replaceChildren(createUraNoteIcon());
  }

  /**
   * The gutter button: select the clicked lines (so Add to Chat, ⌘>, takes them on) and ask the
   * stream to open the note composer on them.
   */
  private addNote(range: SelectedLines): void {
    const { file } = this;
    if (file === undefined) {
      return;
    }
    this.diff?.setSelectedLines(range);
    this.lineSelection = range;
    const anchor = anchorFromTarget(
      targetFrom({ file, hunk: -1, selection: range, line: undefined, collapsed: false }),
    );
    this.dispatchEvent(
      new CustomEvent('beuve-note-add', { detail: { anchor }, bubbles: true, composed: true }),
    );
  }

  /** A reviewed card is only its header (ADR 0064); a click on its check shows the diff again. */
  private unmark(event: Event): void {
    event.stopPropagation();
    const path = this.file?.path;
    if (path !== undefined) {
      this.dispatchEvent(
        new CustomEvent('beuve-file-reviewed', {
          detail: { path, reviewed: false },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  /** Delegates the crossing events while an insight note is there to act on them. */
  private syncCrossingDelegation(): void {
    const isNeeded = this.insights.length > 0;
    if (isNeeded && this.crossingDelegation === undefined) {
      this.crossingDelegation = new AbortController();
      delegateActions(this.renderRoot, this.crossing, { signal: this.crossingDelegation.signal });
    } else if (!isNeeded && this.crossingDelegation !== undefined) {
      this.crossingDelegation.abort();
      this.crossingDelegation = undefined;
    }
  }

  /** While editing, the editing keys come first: listeners on the host, from start to end. */
  private syncEditKeys(): void {
    if (this.edit !== undefined && this.editKeys === undefined) {
      this.editKeys = new AbortController();
      const { signal } = this.editKeys;
      this.addEventListener('keydown', this.onEditKeyCapture, { capture: true, signal });
      this.addEventListener('keydown', this.onEditKeyBubble, { signal });
    } else if (this.edit === undefined && this.editKeys !== undefined) {
      this.editKeys.abort();
      this.editKeys = undefined;
    }
  }

  private noteElement({ note: slot, placement }: PlacedSlot): HTMLElement {
    const { note } = slot;
    switch (note.kind) {
      case 'ura': {
        return uraMarkerElement(note.item, outsideLabel(slot, placement));
      }
      case 'insight': {
        return this.insightNode(note.insight);
      }
      case 'composer': {
        return this.composerNode();
      }
    }
  }

  /** A `/review` finding's note; it stays expanded across re-renders until the reviewer collapses it. */
  private insightNode(insight: ReviewInsight): HTMLElement {
    return createInsightElement(insight, this.openInsights.has(insight.key));
  }

  /** The insight note `element` is in, and its insight. */
  private insightOf(element: HTMLElement): InsightNote | undefined {
    const note = element.closest<HTMLElement>('[data-insight-key]');
    const key = note?.dataset['insightKey'];
    const insight = this.insights.find((candidate) => candidate.key === key);
    if (note === null || insight === undefined) {
      return undefined;
    }
    return { note, insight };
  }

  /** Expands or collapses (`undefined`: toggles) the note `element` is in, and remembers it. */
  private toggleInsight(element: HTMLElement, isOpen: boolean | undefined): void {
    const found = this.insightOf(element);
    if (found === undefined) {
      return;
    }
    const { note, insight } = found;
    const isOpening = isOpen ?? !note.classList.contains('open');
    setInsightOpen(note, insight, isOpening);
    if (isOpening) {
      this.openInsights.add(insight.key);
    } else {
      this.openInsights.delete(insight.key);
    }
  }

  /** Enter or Space on the note's line toggles it; Escape collapses it, back on its line. */
  private onInsightKey(event: KeyboardEvent, note: HTMLElement): void {
    const line = note.querySelector<HTMLElement>('.insight-line');
    const isOpen = note.classList.contains('open');
    if (event.composedPath()[0] === line && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      event.stopPropagation();
      this.toggleInsight(note, !isOpen);
    } else if (isOpen && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.toggleInsight(note, false);
      line?.focus({ preventScroll: true });
    }
  }

  private emitInsight(element: HTMLElement, name: string): void {
    const insight = this.insightOf(element)?.insight;
    if (insight === undefined) {
      return;
    }
    const detail = { messageId: insight.messageId, finding: insight.index };
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  /** Gutter marks for the insights: one adopted style sheet in the diff's shadow root (ADR 0061). */
  private syncInsightMarks(): void {
    const root = this.renderRoot.querySelector('diffs-container')?.shadowRoot;
    if (root === undefined || root === null) {
      return;
    }
    const css = insightMarkCssFrom(
      this.diffStyle,
      planInsightMarks(this.file?.hunks ?? [], this.insights),
    );
    if (css === '' && this.markSheet === undefined) {
      return;
    }
    const sheet = this.markSheet ?? new CSSStyleSheet();
    this.markSheet = sheet;
    sheet.replaceSync(css);
    if (!root.adoptedStyleSheets.includes(sheet)) {
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    }
  }

  /** One composer element per card, kept while it is open so typing survives re-renders. */
  private composerNode(): BeuveUraComposer {
    const element = this.composerElement ?? document.createElement('beuve-ura-composer');
    this.composerElement = element;
    this.syncComposer();
    return element;
  }

  private syncComposer(): void {
    const { composer, composerElement } = this;
    if (composerElement === undefined) {
      return;
    }
    if (composer === undefined || composer.path !== this.file?.path) {
      this.composerElement = undefined;
      return;
    }
    composerElement.where = composer.where;
    composerElement.patch = composer.suggestedPatch ?? '';
    composerElement.saving = composer.saving;
    composerElement.error = composer.error;
  }

  private renderCode(file: DiffFileView): TemplateResult | typeof nothing {
    if (this.collapsed && this.reviewed === 'yes' && this.deferral === undefined) {
      return nothing;
    }
    if (this.collapsed) {
      return this.renderCollapsed();
    }
    if (this.isFallback) {
      return this.renderFallback(file);
    }
    if (file.hunks.length === 0) {
      return html`<p class="empty">${file.binary ? 'Binary file' : 'No textual changes'}</p>`;
    }
    if (this.mounted) {
      return html`${keyed(this.codeGeneration, html`<div class="code"></div>`)}`;
    }
    return html`<div
      class="code placeholder"
      style=${styleMap({ 'block-size': `${String(this.measuredHeight ?? estimateHeight(file))}px` })}
    ></div>`;
  }

  private renderTag(): TemplateResult | typeof nothing {
    const reason = this.deferral?.reason;
    if (reason === undefined || (reason === 'large' && !this.collapsed)) {
      return nothing;
    }
    const label = {
      'no-diff': 'diff off',
      generated: 'generated',
      lockfile: 'lockfile',
      large: 'large',
    }[reason];
    return html`<span class="tag" title=${this.deferral?.why ?? ''}>${label}</span>`;
  }

  /** A check before the status of a file marked reviewed (ADR 0064). */

  private renderReviewedMark(): TemplateResult | typeof nothing {
    if (this.reviewed === 'yes') {
      return html`<button
        type="button"
        class="reviewed-mark"
        title=${`Reviewed — click to unmark (${shortcutOf('toggle-reviewed', keyPlatformOf(navigator.platform))})`}
        aria-label="Reviewed; unmark"
        data-action="unmark"
      >
        ${checkIcon}
      </button>`;
    }
    return nothing;
  }

  /** Marked reviewed, but the file's diff is not the one that was reviewed any more. */
  private renderChangedSince(): TemplateResult | typeof nothing {
    if (this.reviewed === 'changed-since') {
      return html`<span class="changed-since" title="Changed since you reviewed it"
        >changed since reviewed</span
      >`;
    }
    return nothing;
  }

  /** "2 insights" on a collapsed card: its findings are on lines the reviewer cannot see yet (ADR 0061). */
  private renderInsightBadge(): TemplateResult | typeof nothing {
    if (this.collapsed && this.insights.length > 0) {
      return html`<span
        class="tag insight-badge"
        title="/review findings on this file's lines; load the diff to read them"
        >${describeInsightCount(this.insights.length)}</span
      >`;
    }
    return nothing;
  }

  /** The count of the file's errors and warnings, or "checking…" (ADR 0111). */
  private renderDiagnosticsNote(): TemplateResult | typeof nothing {
    const note = describeDiagnostics(this.diagnostics);
    if (note === undefined) {
      return nothing;
    }
    return html`<span class="tag diagnostics-note ${note.tone}" title=${note.title}
      >${note.text}</span
    >`;
  }

  /**
   * Underlines each diagnostic's text on the head lines the diff shows. A line the diff doesn't
   * show (collapsed between hunks) gets no underline, but still counts in the header.
   */
  private syncDiagnosticHighlights(): void {
    const { diagnostics } = this;
    if (diagnostics?.kind !== 'ready') {
      this.diagnosticHighlights.clear();
      return;
    }
    const rowOf = (line: number): HTMLElement | undefined => {
      const found = this.findRow('additions', line) ?? this.findRow('context', line);
      if (found instanceof HTMLElement) {
        return found;
      }
      return undefined;
    };
    const ranges = diagnosticRangesFrom(diagnostics.view.diagnostics, rowOf);
    this.diagnosticHighlights.set(ranges);
  }

  /** Tells the window this card shows its file, so it asks the language servers about it. */
  private wantDiagnostics(): void {
    const { file } = this;
    if (
      file === undefined ||
      this.diagnostics !== undefined ||
      !this.mounted ||
      this.collapsed ||
      file.status === 'deleted' ||
      file.binary
    ) {
      return;
    }
    const detail: DiagnosticsWantedDetail = { path: file.path };
    this.dispatchEvent(
      new CustomEvent('beuve-diagnostics-wanted', { detail, bubbles: true, composed: true }),
    );
  }

  private expand(event: Event): void {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('beuve-diff-toggle', {
        detail: { path: this.file?.path, expand: true },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** What a collapsed card says instead of its diff: why, how big, and how to load it. */
  private renderCollapsed(): TemplateResult {
    const { deferral } = this;
    return html`<div class="collapsed-body">
      <span class="why">${deferral?.why ?? 'Collapsed.'}</span>
      ${
        deferral === undefined
          ? nothing
          : html`<span class="size"
              >${countFormat.format(deferral.rows)} lines · ${formatSize(deferral.characters)}</span
            >`
      }
      <button
        class="button"
        type="button"
        title=${`Expand File (${shortcutOf('expand', keyPlatformOf(navigator.platform))})`}
        data-action="expand"
      >
        Load diff
      </button>
    </div>`;
  }

  private renderFallback(file: DiffFileView): TemplateResult {
    const path = file.path;
    return html`${uraMarkersFrom(path, this.uraItems).map((marker) => uraMarkerElement(marker.item, undefined))}
      ${this.insights.map((insight) => this.insightNode(insight))}
      ${this.composer?.path === path ? this.composerNode() : nothing}
      <pre>
${splitPatch(file.patch).map((line) => {
          return html`<span class="line ${line.kind}">${line.text === '' ? ' ' : line.text}</span>`;
        })}</pre>`;
  }

  /** ⌘/Ctrl+Enter: the edit as a patch of the target lines, unless it strays outside them. */
  private saveEdit(): void {
    const { edit, editor, editHead, file } = this;
    if (editor === undefined || editHead === undefined || edit?.phase !== 'editing') {
      if (edit?.phase === 'failed') {
        this.cancelEdit('');
      }
      return;
    }
    const plan = buildSuggestedPatch({
      path: file?.path ?? '',
      head: editHead,
      edited: editor.getText(),
      range: edit.target,
    });
    switch (plan.kind) {
      case 'outside': {
        this.edit = { ...edit, error: plan.message };
        return;
      }
      case 'unchanged': {
        this.cancelEdit('Nothing changed, so there is no suggestion.');
        return;
      }
      case 'patch': {
        this.endEdit();
        const detail: SuggestionSaveDetail = { target: edit.target, patch: plan.text };
        this.dispatchEvent(
          new CustomEvent('beuve-suggestion-save', { detail, bubbles: true, composed: true }),
        );
      }
    }
  }

  private cancelEdit(message: string): void {
    this.endEdit();
    this.dispatchEvent(
      new CustomEvent('beuve-suggestion-cancel', {
        detail: { message },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Detaches the editor, discarding its text, and remounts the diff as it was. */
  private endEdit(): void {
    const isAttached = this.editor !== undefined;
    this.diff?.setCodeScrollLeft(0);
    this.editor?.cleanUp('discard');
    this.editor = undefined;
    this.editHead = undefined;
    this.edit = undefined;
    if (!isAttached) {
      return;
    }

    this.diff?.cleanUp();
    this.diff = undefined;
    this.codeGeneration += 1;
  }

  private renderEditBar(): TemplateResult | typeof nothing {
    const { edit } = this;
    if (edit === undefined) {
      return nothing;
    }
    return html`<div class="edit-bar" role="status">
      <span class="what">${editDescription(edit.target)}</span>
      <span>${editPhaseNotes[edit.phase]}</span>
      ${edit.error === '' ? nothing : html`<span class="error" role="alert">${edit.error}</span>`}
    </div>`;
  }

  /** Scrolls a row (or the card) into view vertically, keeping the code's horizontal scroll. */
  private scrollToRow(row: Element | undefined): void {
    const left = this.diff?.getCodeScrollLeft();
    if (row === undefined) {
      this.scrollIntoView({ block: 'start' });
    } else {
      row.scrollIntoView({ block: 'center' });
    }
    if (left !== undefined) {
      this.diff?.setCodeScrollLeft(left);
    }
  }

  /**
   * What the reviewer points at on this card (ADR 0063): the selection, else the line a jump
   * landed on, else the focused hunk, else the file. Every line-taking action starts here.
   */
  target(): ReviewTarget {
    return targetFrom({
      file: this.file,
      hunk: this.activeHunk,
      selection: this.lineSelection,
      line: this.focusedLine,
      collapsed: this.collapsed,
    });
  }

  /** The head-side token the reviewer last clicked, until they select or step elsewhere. */
  tokenClicked(): ClickedToken | undefined {
    return this.clickedToken;
  }

  /**
   * Scrolls to lines `start`–`end` of one side and selects them, for a chat chip: head lines as
   * Open in Editor and citations find them, base lines by their own numbers on the deleted side.
   */
  async revealRange({ start, end, side }: SideLines): Promise<void> {
    this.mounted = true;
    await this.updateComplete;
    const row = await waitFor(() => {
      if (side === 'base') {
        return this.findRow('deletions', start);
      }
      return this.findRow('additions', start) ?? this.findRow('context', start);
    });
    const librarySide = librarySides[side];
    const range: SelectedLines = { start, end, side: librarySide, endSide: librarySide };
    this.programmaticStep = undefined;
    this.diff?.setSelectedLines(range);
    this.lineSelection = range;
    this.focusedLine = undefined;
    this.scrollToRow(row);
  }

  /** What Suggest Edit would edit here: the target's lines, or the staged note under them. */
  editTarget(items: readonly UraItemView[], headSha: string): EditTarget | undefined {
    return editTargetFrom(this.target(), items, headSha);
  }

  /**
   * Runs the card's action for a click or key event that the diff stream's delegated listener
   * caught on this card (ADR 0074).
   */
  runAction(event: Event): void {
    const handlers = (this.actions as DelegatedActions)[event.type as 'click' | 'keydown'];
    dispatchAction(event, this.renderRoot, handlers as ActionHandlers<Event> | undefined);
  }

  /** A pointer moved over the card: the library attaches its gutter button on hover, labelled once per diff. */
  notePointerMove(): void {
    if (!this.isGutterLabelled) {
      this.labelGutterButton();
    }
  }

  /**
   * Opens `@pierre/diffs/edit` on the head side of this diff (ADR 0043), once both full files are
   * loaded through `session:get-file-pair`, with the caret on the target's first line. Nothing
   * is ever written: saving builds a suggested patch for the target lines and emits
   * `beuve-suggestion-save`; cancelling emits `beuve-suggestion-cancel`.
   */
  async startEdit(target: EditTarget): Promise<void> {
    const { file, loadFilePair: loader } = this;
    if (file === undefined || loader === undefined || this.edit !== undefined) {
      return;
    }
    this.edit = { target, phase: 'loading', error: '' };
    this.mounted = true;
    try {
      const [pair, module] = await Promise.all([loader(file.path), loadEditor()]);
      const diff = await waitForValue(() => this.diff);
      if (diff === undefined || pair?.newContents === undefined) {
        throw new Error('beuve could not load this file to edit it.');
      }
      await diff.prepareForEditing();
      if (this.edit.target !== target || this.diff !== diff) {
        return;
      }
      const editor = new module.Editor<'file-diff', PlacedSlot>('file-diff');
      editor.edit(diff);
      let suggested: string | undefined;
      if (target.patch !== undefined) {
        suggested = applySuggestedPatch({ head: pair.newContents, patch: target.patch });
      }
      if (suggested !== undefined && suggested !== pair.newContents) {
        // Re-editing starts from the suggestion; undo goes back to the head.
        const end = { line: pair.newContents.split('\n').length, character: 0 };
        editor.applyEdits([
          { range: { start: { line: 0, character: 0 }, end }, newText: suggested },
        ]);
      }
      this.editor = editor;
      this.editHead = pair.newContents;
      this.edit = { target, phase: 'editing', error: '' };
      editor.focus({ lineNumber: target.startLine, preventScroll: false });
      await this.revealLine(target.startLine);
    } catch (error: unknown) {
      this.endEdit();
      let message = 'The editor could not start.';
      if (Error.isError(error)) {
        message = error.message;
      }
      this.edit = { target, phase: 'failed', error: message };
    }
  }

  /** Scrolls to head line `line` and makes it the card's target (a citation or flow jump). */
  async focusLine(line: number): Promise<void> {
    await this.revealLine(line);
    // eslint-disable-next-line unicorn/no-null -- the library clears the selection with null.
    this.diff?.setSelectedLines(null);
    this.lineSelection = undefined;
    this.clickedToken = undefined;
    this.focusedLine = line;
  }

  /** Scrolls head line `line` into view (or the card's header without one), mounting the diff. */
  async revealLine(line: number | undefined): Promise<void> {
    this.mounted = true;
    await this.updateComplete;
    if (line === undefined) {
      this.scrollToRow(undefined);
      return;
    }
    const row = await waitFor(() => {
      return this.findRow('additions', line) ?? this.findRow('context', line);
    });
    this.scrollToRow(row);
  }

  /** Selects hunk `index` and scrolls its first change into view, mounting the diff if needed. */
  async revealHunk(index: number): Promise<void> {
    this.mounted = true;
    this.activeHunk = index;
    await this.updateComplete;
    let step: HunkStep | undefined;
    if (this.metadata !== undefined) {
      step = planHunkSteps(this.metadata.hunks, this.diffStyle)[index];
    }
    if (step === undefined) {
      this.scrollToRow(undefined);
      return;
    }
    const { side, start } = step;
    this.scrollToRow(await waitFor(() => this.findRow(side, start)));
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    this.syncEditKeys();
    if (changed.has('activeHunk')) {
      this.focusedLine = undefined;
      this.clickedToken = undefined;
    }
    if (changed.has('composer')) {
      this.syncComposer();
    }
    if (changed.has('mounted') && this.mounted && this.library === undefined) {
      void this.loadLibrary();
    }
    if (changed.has('mounted') && !this.mounted && this.edit !== undefined) {
      // An open edit keeps its diff mounted however far the stream scrolls.
      this.mounted = true;
    }
    if (changed.has('diffStyle') && this.diff !== undefined && this.edit === undefined) {
      this.diff.cleanUp();
      this.diff = undefined;
      this.codeGeneration += 1;
      this.measuredHeight = undefined;
    }
    if (changed.has('collapsed') && this.collapsed && this.edit !== undefined) {
      this.collapsed = false;
    }
    if (
      (changed.has('mounted') || changed.has('collapsed')) &&
      (!this.mounted || this.collapsed) &&
      this.diff !== undefined
    ) {
      const height = this.codeHeight;
      if (height !== undefined && height !== 0) {
        this.measuredHeight = height;
      }
      this.unobserveCode();
      this.diff.cleanUp();
      this.diff = undefined;
    }
    if (changed.has('file')) {
      this.measuredHeight = undefined;
      this.revealed = [];
    }
    if (!changed.has('file') && !changed.has('library')) {
      return;
    }
    const { file, library } = this;
    this.metadata = undefined;
    if (file !== undefined && library !== undefined) {
      this.metadata = metadataFrom(library, file);
    }
    this.isFallback = false;
  }

  protected override updated(changed: PropertyValues<this>): void {
    this.wantDiagnostics();
    if (changed.has('diagnostics')) {
      this.syncDiagnosticHighlights();
    }
    this.syncCrossingDelegation();
    const { library, metadata } = this;
    if (
      library === undefined ||
      metadata === undefined ||
      !this.mounted ||
      this.collapsed ||
      this.isFallback ||
      this.editor !== undefined
    ) {
      return;
    }
    const container = this.renderRoot.querySelector<HTMLElement>('.code');
    if (container === null) {
      return;
    }
    this.observeCode(container);
    try {
      this.syncDiff(changed, { library, container, metadata });
      this.syncInsightMarks();
    } catch {
      this.diff?.cleanUp();
      this.diff = undefined;
      this.isFallback = true;
    }
  }

  override render(): TemplateResult {
    const { file } = this;
    if (file === undefined) {
      return html``;
    }
    return html`
      <div class="header">
        <div
          class="title"
          title=${this.collapsed && this.reviewed === 'yes' ? 'Reviewed: click to show the diff' : ''}
          data-action="title"
        >
          ${this.renderReviewedMark()}
          <span class="badge status">${file.status}</span>
          <span class="path" title=${file.path}>
            ${
              file.oldPath === undefined
                ? nothing
                : html`<span class="old-path">${pathText(file.oldPath)} → </span>`
            }${pathText(file.path)}
          </span>
          ${this.renderChangedSince()} ${this.renderTag()} ${this.renderInsightBadge()}
          ${this.renderDiagnosticsNote()}
          <span class="counts"
            ><span class="additions">+${file.additions}</span>
            <span class="deletions">−${file.deletions}</span></span
          >
        </div>
        ${this.renderEditBar()}
      </div>
      ${this.peek === undefined ? nothing : html`<beuve-peek-portal .peek=${this.peek}></beuve-peek-portal>`}
      ${
        this.flow === undefined
          ? nothing
          : html`<beuve-flow-portal
              .flow=${this.flow}
              @flow-node-activate=${this.onFlowNodeActivate}
            ></beuve-flow-portal>`
      }
      ${this.renderCode(file)}
    `;
  }
}

/** "line N, outside the shown hunks" for a note the diff doesn't show, else `undefined`. */
function outsideLabel(range: HeadSideRange, placement: NotePlacement): string | undefined {
  if (placement.kind !== 'hidden') {
    return undefined;
  }
  if (range.lineStart === range.lineEnd) {
    return `line ${String(range.lineStart)}, outside the shown hunks`;
  }
  return `lines ${String(range.lineStart)}–${String(range.lineEnd)}, outside the shown hunks`;
}

/**
 * A staged item's marker: its severity and title on one quiet line, built as text nodes, and for
 * lines the diff doesn't show, a button that reveals them (delegated as `reveal-note`).
 */
function uraMarkerElement(item: UraItemView, outside: string | undefined): HTMLElement {
  const labels = describeUraItem(item);
  const marker = document.createElement('div');
  marker.className = `ura-marker ${item.severity}`;
  marker.dataset['uraItemId'] = item.id;
  marker.title = `Staged in the review dock: ${revealFormatControls(labels.anchor)}, from ${labels.origin}`;
  const kind = document.createElement('span');
  kind.className = 'ura-kind';
  kind.textContent = `${labels.emoji} Staged · ${labels.severity}`;
  if (item.suggestedPatch !== undefined) {
    kind.textContent += ' · suggestion';
  }
  kind.prepend(createUraNoteIcon());
  const title = document.createElement('span');
  title.className = 'ura-title';
  title.append(...parseInlineTitle(headlineOfUraItem(item)).map((span) => createInlineNode(span)));
  marker.append(kind, title);
  if (outside !== undefined) {
    const reveal = document.createElement('button');
    reveal.type = 'button';
    reveal.className = 'ura-outside';
    reveal.dataset['action'] = 'reveal-note';
    reveal.dataset['uraItemId'] = item.id;
    reveal.title = 'Show these lines in the diff';
    reveal.textContent = outside;
    marker.append(reveal);
  }
  return marker;
}

/**
 * Shared by every card: the library (loaded once by `loadDiffsLibrary`, with the themes) and
 * the highlighting worker pool, started once.
 */
const shared: {
  library: Promise<typeof Diffs> | undefined;
  pool: WorkerPoolManager | undefined;
} = {
  library: undefined,
  pool: undefined,
};

/** Highlighting workers (ADR 0050); each compiles the grammars it is given on its own. */
const workerCount = 2;
/** Diffs this small highlight on the main thread: faster than a worker round trip, and no plain-text pass. */
const mainThreadMaxCharacters = 12_000;

async function loadDiffs(): Promise<typeof Diffs> {
  shared.library ??= loadDiffsOnce();
  return shared.library;
}

async function loadDiffsOnce(): Promise<typeof Diffs> {
  const [library, workers] = await Promise.all([loadDiffsLibrary(), loadWorkerModule()]);
  shared.pool = undefined;
  if (workers !== undefined) {
    shared.pool = startWorkerPool(workers);
  }
  return library;
}

/** The pool's module; without it, cards highlight on this thread as before. */
async function loadWorkerModule(): Promise<typeof DiffsWorker | undefined> {
  try {
    return await import('@pierre/diffs/worker');
  } catch {
    return undefined;
  }
}

/**
 * Starts the pool of `@pierre/diffs/worker` highlighters (ADR 0050) once the themes are
 * registered, since the pool resolves them on this thread and sends them to its workers. The
 * worker is its own bundle at `diff-worker/worker.js` next to the page, loaded under
 * `script-src 'self'`. When it cannot start, the pool reports it and cards highlight here.
 */
function startWorkerPool(workers: typeof DiffsWorker): WorkerPoolManager {
  const url = new URL('diff-worker/worker.js', document.baseURI);
  return new workers.WorkerPoolManager(
    {
      workerFactory: (): Worker => {
        return new Worker(url, { type: 'module', name: 'beuve-highlighter' });
      },
      poolSize: workerCount,
      mainThreadMaxCharacters,
      onWorkerError: (event): void => {
        event.preventDefault();
      },
    },
    {
      theme: diffsThemeNames,
      preferredHighlighter: 'shiki-js',
      lineDiffType: 'word-alt',
      // Spans then carry their column, which Go to Definition needs from a click.
      useTokenTransformer: true,
      langs: [],
    },
  );
}

const sharedEditor: { module: Promise<typeof DiffsEdit> | undefined } = { module: undefined };

/** `@pierre/diffs/edit`, a lazy chunk loaded by the first Suggest Edit (ADR 0043). */
async function loadEditor(): Promise<typeof DiffsEdit> {
  sharedEditor.module ??= import('@pierre/diffs/edit');
  return sharedEditor.module;
}

const checkIcon: SVGTemplateResult = svg`<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 7.2 6 9.6l4.6-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** Parses the patch, keyed by its blobs and hunks, and turns highlighting off for languages beuve doesn't ship. */
function metadataFrom(library: typeof Diffs, file: DiffFileView): FileDiffMetadata | undefined {
  // The hunks tell apart diffs of the same blobs: a whitespace-ignoring variant, or an interdiff.
  const hunks = file.hunks.map((hunk) => hunk.header).join('\n');
  const cacheKey = [file.path, file.oldBlobSha ?? '', file.newBlobSha ?? '', hunks].join('\0');
  const metadata = library.processFile(file.patch, { cacheKey, isGitDiff: true });
  if (metadata === undefined) {
    return undefined;
  }
  const language = library.getFiletypeFromFileName(file.path);
  if (Object.hasOwn(highlightedLanguages, language)) {
    return metadata;
  }
  return library.setLanguageOverride(metadata, 'text');
}

async function loadFiles(
  loader: FilePairLoader,
  fileDiff: FileDiffMetadata,
): Promise<FileDiffLoadedFiles> {
  const pair = await loader(fileDiff.name);
  if (pair?.newContents === undefined) {
    throw new Error('beuve could not load this file to expand it');
  }
  const newFile = { name: fileDiff.name, contents: pair.newContents };
  if (pair.oldContents === undefined) {
    // eslint-disable-next-line unicorn/no-null -- the library marks a pure rename's old side with null.
    return { oldFile: null, newFile };
  }
  return {
    oldFile: { name: fileDiff.prevName ?? fileDiff.name, contents: pair.oldContents },
    newFile,
  };
}

/** Where a card's diff renders: the library, the element it fills, and the parsed file. */
interface DiffMount {
  readonly library: typeof Diffs;
  readonly container: HTMLElement;
  readonly metadata: FileDiffMetadata;
}

/** An insight's note element, and the insight it shows. */
interface InsightNote {
  readonly note: HTMLElement;
  readonly insight: ReviewInsight;
}

const editPhaseNotes: Readonly<Record<EditSession['phase'], string>> = {
  loading: 'Opening the editor…',
  editing: 'Your files are never written',
  failed: '',
};

/** What the edit bar says is being edited: a new suggestion, or the item's own. */
function editDescription(target: EditTarget): string {
  const lines = editedLines(target);
  if (target.itemId === undefined) {
    return `Suggesting ${lines}`;
  }
  return `Editing the suggestion for ${lines}`;
}

/** `line 12`, or `lines 12–15`. */
function editedLines({ startLine, endLine }: EditTarget): string {
  if (startLine === endLine) {
    return `line ${String(startLine)}`;
  }
  return `lines ${String(startLine)}–${String(endLine)}`;
}

const estimatedHeights = new WeakMap<DiffFileView, number>();

/** About the rendered height of the patch: its lines, plus a separator per hunk; once per file. */
function estimateHeight(file: DiffFileView): number {
  const known = estimatedHeights.get(file);
  if (known !== undefined) {
    return known;
  }
  const lines = splitPatch(file.patch).filter((line) => {
    return line.kind !== 'meta' && line.kind !== 'hunk';
  }).length;
  const height = lines * estimatedLineHeight + file.hunks.length * estimatedSeparatorHeight;
  estimatedHeights.set(file, height);
  return height;
}

const countFormat = new Intl.NumberFormat('en');

function formatSize(characters: number): string {
  if (characters < 1024 * 1024) {
    return `${String(Math.max(1, Math.round(characters / 1024)))} KB`;
  }
  return `${(characters / 1024 / 1024).toFixed(1)} MB`;
}

/** Polls a few animation frames for a value that a later render sets. */
async function waitForValue<T>(find: () => T | undefined): Promise<T | undefined> {
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

/** Polls a few animation frames for an element the library renders asynchronously. */
async function waitFor(find: () => Element | undefined): Promise<Element | undefined> {
  for (let frame = 0; frame < 30; frame += 1) {
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
    'beuve-file-card': BeuveFileCard;
  }
}
