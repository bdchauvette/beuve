import type * as Diffs from '@pierre/diffs';
import type {
  FileDiff,
  FileDiffLoadedFiles,
  FileDiffMetadata,
  OnTokenEventProps,
} from '@pierre/diffs';
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
  ReviewThreadView,
  UraItemView,
} from '#contract/ipc-contract.ts';

import './beuve-flow-portal.ts';
import type { FlowNodeActivateDetail } from './flow-graph-view.ts';
import './beuve-peek-portal.ts';
import './beuve-ura-composer.ts';
import type { BeuveUraComposer } from './beuve-ura-composer.ts';
import type { UraDeleteDetail } from './app-event-details.ts';
import type { NoteEdit } from './note-edit-from.ts';
import type { SuggestionFieldView } from './suggestion-field-view.ts';
import { describeDiagnostics } from './describe-diagnostics.ts';
import { DiagnosticHighlights } from './diagnostic-highlights.ts';
import { diagnosticRangesFrom } from './diagnostic-ranges-from.ts';
import type { DiagnosticsWantedDetail, FileDiagnostics } from './file-diagnostics.ts';
import { headRowSelector } from './head-row-selector.ts';
import { characterOffsetAt } from './character-offset-at.ts';
import type { HoverPoint } from './hover-point.ts';
import { highlightedLanguages } from './highlighted-languages.ts';
import { languageFromShebang } from './language-from-shebang.ts';
import type { ClickedToken } from './run-sheet-action.ts';
import type { FlowState } from './flow-state.ts';
import type { PeekState } from './peek-state.ts';
import { planHunkSteps } from './plan-hunk-steps.ts';
import { planStepHighlight } from './plan-step-highlight.ts';
import type { HunkStep } from './plan-hunk-steps.ts';
import type { DiffDeferral } from './plan-diff-deferrals.ts';
import { targetFrom } from './target-from.ts';
import type { ReviewTarget, SelectedLines } from './target-from.ts';
import { splitPatch } from './split-patch.ts';
import { headSideAnnotationsFrom } from './head-side-annotations-from.ts';
import type { HeadSideAnnotation } from './head-side-annotations-from.ts';
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
import { anchorFromTarget } from './anchor-from-target.ts';
import { createUraNoteIcon } from './create-ura-note-icon.ts';
import { uraMarkersFrom } from './ura-markers-from.ts';
import type { UraMarker } from './ura-markers-from.ts';
import { createInsightElement } from './create-insight-element.ts';
import { createNoteAnnotation } from './create-note-annotation.ts';
import { createThreadAnnotation } from './create-thread-annotation.ts';
import { setThreadOpen } from './set-thread-open.ts';
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
import { diffSelectionCss } from './diff-selection-css.ts';
import { countNoun } from './count-noun.ts';
import { createThreadElement } from './create-thread-element.ts';
import { displayIcon } from './display-icon.ts';
import { pathText } from './path-text.ts';
import { placeReviewThreads } from './place-review-threads.ts';
import type { ThreadPlacement } from './place-review-threads.ts';
import { buttonStyles } from './primitives/button-styles.ts';
import { badgeStyles } from './primitives/badge-styles.ts';
import { emptyStateStyles } from './primitives/empty-state-styles.ts';
import { segmentedStyles } from './primitives/segmented-styles.ts';
import './rich-view/beuve-rich-view.ts';
import type {
  ImageLoader,
  RichAnnotation,
  RichLinkDetail,
  RichSelectDetail,
} from './rich-view/beuve-rich-view.ts';
import type { ChangeRun } from './rich-view/change-run.ts';
import { changeRunsFrom } from './rich-view/change-runs-from.ts';
import { hunkTargetFrom } from './rich-view/hunk-target-from.ts';
import type { RegionTarget } from './rich-view/region-target.ts';
import type { BeuveRichView } from './rich-view/beuve-rich-view.ts';
import { richViewKindFrom } from './rich-view/rich-view-kind-from.ts';
import { isOutsideHunks } from './is-outside-hunks.ts';

/** Reads both sides of a reviewed file for hunk expansion; `undefined` when it can't. */
export type FilePairLoader = (path: string) => Promise<FilePairView | undefined>;

/** The note composer Add Note opened on this card, and how saving it went. */
export interface ComposerState {
  readonly path: string;
  readonly anchor: UraAnchorView;
  readonly where: string;
  readonly saving: boolean;
  readonly error: string;
  /** The head the note's lines and suggestions are on: the review's, or the edited note's. */
  readonly headSha: string;
  /** The note's suggestion fields (ADR 0162). */
  readonly suggestions: readonly SuggestionFieldView[];
  /** The staged note this composer edits in place of its marker (ADR 0129); absent for a new one. */
  readonly edit?: NoteEdit;
  /**
   * Shown above the cards, not under its lines on a card (ADR 0162): a sheet's lines that no
   * card can be counted on to show. A composer on a path no card shows is there too.
   */
  readonly isAboveCards?: boolean;
}

/** `beuve-note-edit`: the reviewer asked to edit staged note `itemId` from its marker. */
export interface NoteEditDetail {
  readonly itemId: string;
}

/** Sent by "Load diff" (or its undo) on a card. */
/** `beuve-token-jump`: ⌘/Ctrl-click on a head-side token, to follow its definition. */
export interface TokenJumpDetail {
  readonly target: ReviewTarget;
  readonly token: ClickedToken | undefined;
}

/** `beuve-token-click`: the reviewer clicked a head-side token of `path` (Suggest Rename…'s target). */
export interface TokenClickDetail {
  readonly path: string;
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

/** What a card annotates under a head line (or above the diff, at line 0). */
type CardNote =
  | { readonly kind: 'ura'; readonly item: UraItemView }
  | { readonly kind: 'insight'; readonly insight: ReviewInsight }
  | { readonly kind: 'thread'; readonly thread: ReviewThreadView }
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
const noThreads: readonly ReviewThreadView[] = [];

/** The `@pierre/diffs` side that holds each side's lines. */
const librarySides = { head: 'additions', base: 'deletions' } as const;

const estimatedLineHeight = 20;
const estimatedSeparatorHeight = 32;

/**
 * One file of the review diff (ADR 0018, 0025): a header with its status, path and line counts,
 * the call-stack peek portal while it is
 * open, and the patch rendered by `@pierre/diffs` with beuve's syntax highlighting (ADR 0119). The diff mounts while the stream sets `mounted` (the card is near
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
    segmentedStyles,
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
        font: var(--beuve-font-code);
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .old-path {
        color: var(--beuve-text-muted);
      }

      .status {
        text-transform: uppercase;
      }

      .view-toggle {
        flex: none;
        font: var(--beuve-font-small);
      }

      beuve-rich-view {
        border-block-start: var(--beuve-border-width) solid var(--beuve-border);
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
        font: var(--beuve-font-code);
        color: var(--beuve-diff-added-text);
      }

      .deletions {
        font: var(--beuve-font-code);
        color: var(--beuve-diff-removed-text);
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
        --diffs-font-family: var(--beuve-font-family-code);
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
        --diffs-fg-number-addition-override: var(--beuve-diff-added-number-text);
        --diffs-fg-number-deletion-override: var(--beuve-diff-removed-number-text);
        --diffs-bg-selection-override: var(--beuve-diff-selection-bg);
        --diffs-bg-selection-number-override: var(--beuve-diff-selection-number-bg);
        --diffs-selection-color-override: var(--beuve-accent);
        --diffs-bg-hover-override: var(--beuve-surface-sunken);
        --diffs-bg-search-match-override: var(--beuve-diff-search-match-bg);
        --diffs-fg-search-match-override: var(--beuve-diff-search-match-text);
        --diffs-bg-search-match-current-override: var(--beuve-diff-search-current-bg);
        --diffs-fg-search-match-current-override: var(--beuve-diff-search-current-text);
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

      /* ADR 0155: notes, insights and threads under diff lines share one head and open in place. */
      /* The note measure, as the composer's form has, so a note keeps its width when edited. */
      .annotation {
        box-sizing: border-box;
        max-inline-size: var(--beuve-size-note-measure);
        margin: var(--beuve-space-0-5) var(--beuve-space-3);
        border: var(--beuve-border-width) solid var(--beuve-border);
        border-radius: var(--beuve-radius);
        background: var(--beuve-surface);
        font: var(--beuve-font-small);
        color: var(--beuve-text);
        white-space: normal;
      }

      .annotation.insight {
        border-style: dashed;
        background: transparent;
      }

      .annotation.insight.unconfirmed {
        opacity: 0.65;
      }

      .annotation.insight.unconfirmed.open,
      .annotation.insight.unconfirmed:hover {
        opacity: 1;
      }

      .annotation-head {
        display: flex;
        align-items: baseline;
        gap: var(--beuve-space-2);
        min-inline-size: 0;
        padding: var(--beuve-space-0-5) var(--beuve-space-2);
        white-space: nowrap;
        cursor: pointer;
      }

      .annotation-toggle {
        display: flex;
        flex: 1;
        align-items: baseline;
        gap: var(--beuve-space-1-5);
        min-inline-size: 0;
        padding: 0;
        border: 0;
        background: none;
        font: inherit;
        color: inherit;
        text-align: start;
        cursor: pointer;
      }

      .annotation-toggle:focus-visible {
        outline: var(--beuve-border-width) solid var(--beuve-accent);
        outline-offset: var(--beuve-focus-ring-offset);
      }

      .annotation-emoji {
        flex: none;
        inline-size: calc(1.5 * var(--beuve-measure-em));
        text-align: center;
      }

      .annotation-text {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        font-weight: var(--beuve-font-weight-medium);
      }

      .annotation-text.body {
        font-weight: var(--beuve-font-weight-normal);
      }

      .annotation.open .annotation-text {
        overflow: visible;
        white-space: normal;
      }

      .annotation-marks {
        display: flex;
        flex: none;
        gap: var(--beuve-space-1);
        color: var(--beuve-text-muted);
        font-weight: var(--beuve-font-weight-semibold);
      }

      .annotation-mark + .annotation-mark::before {
        content: '•';
        margin-inline-end: var(--beuve-space-1);
        color: var(--beuve-text-faint);
        font-weight: var(--beuve-font-weight-normal);
      }

      .annotation-mark.mark-blocking {
        color: var(--beuve-danger);
      }

      .annotation-mark.mark-insight {
        color: var(--beuve-violet);
      }

      .annotation-mark.mark-unconfirmed {
        font-style: italic;
        font-weight: var(--beuve-font-weight-normal);
      }

      .annotation-chevron {
        flex: none;
        color: var(--beuve-text-faint);
      }

      .annotation-chevron::before {
        content: '▸';
      }

      .annotation.open .annotation-chevron::before {
        content: '▾';
      }

      .annotation-reveal {
        flex: none;
        padding: 0 var(--beuve-space-1);
        border: none;
        border-radius: var(--beuve-radius-small);
        background: none;
        font: inherit;
        color: var(--beuve-accent);
        cursor: pointer;
      }

      .annotation-delete {
        flex: none;
        padding: 0 var(--beuve-space-1);
        border: none;
        border-radius: var(--beuve-radius-small);
        background: none;
        font: inherit;
        color: var(--beuve-text-faint);
        cursor: pointer;
      }

      .annotation-delete:hover {
        color: var(--beuve-text);
      }

      .annotation-delete:focus-visible {
        outline: var(--beuve-border-width) solid var(--beuve-accent);
        outline-offset: var(--beuve-focus-ring-offset);
      }

      .annotation-reveal:hover {
        text-decoration: underline;
      }

      .annotation-reveal:focus-visible {
        outline: var(--beuve-border-width) solid var(--beuve-accent);
        outline-offset: var(--beuve-focus-ring-offset);
      }

      .annotation code {
        padding: 0 var(--beuve-space-0-5);
        border-radius: var(--beuve-radius-small);
        background: var(--beuve-surface-sunken);
        font: var(--beuve-font-code);
      }

      .annotation-body {
        display: flex;
        flex-direction: column;
        gap: var(--beuve-space-1-5);
        padding-block: var(--beuve-space-1-5) var(--beuve-space-2);
        padding-inline: calc(
            var(--beuve-space-2) + 1.5 * var(--beuve-measure-em) + var(--beuve-space-1-5)
          )
          var(--beuve-space-2);
        border-block-start: var(--beuve-border-width) solid var(--beuve-border);
      }

      .annotation-body .thread {
        margin: 0;
        padding: 0;
        border: 0;
        background: none;
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

      .thread {
        margin: var(--beuve-space-1) var(--beuve-space-3);
        padding: var(--beuve-space-1) var(--beuve-space-2);
        border-inline-start: var(--beuve-border-width-thick) solid var(--beuve-border);
        border-radius: var(--beuve-radius-small);
        background: var(--beuve-surface-sunken);
        font: var(--beuve-font-small);
        white-space: normal;
        color: var(--beuve-text);
      }

      .thread.outdated {
        color: var(--beuve-text-muted);
      }

      .thread-place {
        display: block;
        margin-block-end: var(--beuve-space-0-5);
        font-weight: var(--beuve-font-weight-semibold);
        color: var(--beuve-text-muted);
      }

      .thread-comment + .thread-comment {
        margin-block-start: var(--beuve-space-2);
        padding-block-start: var(--beuve-space-1);
        border-block-start: var(--beuve-border-width) solid var(--beuve-border);
      }

      .thread-header {
        display: flex;
        align-items: baseline;
        gap: var(--beuve-space-2);
        color: var(--beuve-text-muted);
      }

      .thread-author {
        font-weight: var(--beuve-font-weight-semibold);
        color: var(--beuve-text);
      }

      .thread-open {
        margin-inline-start: auto;
        padding: 0 var(--beuve-space-1);
        border: none;
        border-radius: var(--beuve-radius-small);
        background: none;
        font: inherit;
        color: var(--beuve-accent);
        cursor: pointer;
      }

      .thread-open:hover {
        background: var(--beuve-surface-hover);
      }

      .thread-body :is(p, ul, ol, blockquote, pre) {
        margin: 0 0 var(--beuve-space-1);
      }

      .thread-body :is(ul, ol) {
        padding-inline-start: var(--beuve-space-4);
      }

      .thread-body pre {
        padding: var(--beuve-space-1) var(--beuve-space-2);
        border-radius: var(--beuve-radius-small);
        background: var(--beuve-surface);
        overflow-inline: auto;
      }

      .thread-body a {
        color: var(--beuve-accent);
      }

      .threads-aside {
        margin: var(--beuve-space-1) var(--beuve-space-3);
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      .threads-aside > summary {
        cursor: pointer;
      }

      .insight-text pre {
        margin: 0 0 var(--beuve-space-1);
        padding: var(--beuve-space-1) var(--beuve-space-2);
        border-radius: var(--beuve-radius-small);
        background: var(--beuve-surface-sunken);
        overflow-inline: auto;
      }

      :is(.insight-actions, .annotation-actions) {
        display: flex;
        align-items: baseline;
        gap: var(--beuve-space-2);
        color: var(--beuve-text-muted);
      }

      pre {
        margin: 0;
        padding: var(--beuve-space-1) 0;
        overflow-inline: auto;
        font: var(--beuve-font-code);
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
  /** Insight notes the reviewer expanded, by insight key. */
  private readonly openAnnotations = new Set<string>();
  /** The gutter marks' style sheet in this diff's shadow root. */
  private markSheet: CSSStyleSheet | undefined;
  private tintSheet: CSSStyleSheet | undefined;
  /** Whether this diff's gutter button already shows the chat icon. */
  private isGutterLabeled = false;
  /** Bumped to give the diff a fresh container: after a move in the stream, or a layout change. */
  private codeGeneration = 0;
  /** This card's diagnostic underlines in the document's shared highlights. */
  private readonly diagnosticHighlights = new DiagnosticHighlights();
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
      element: props.tokenElement,
    };
    const path = this.file?.path;
    if (path !== undefined) {
      const clicked: TokenClickDetail = { path };
      this.dispatchEvent(
        new CustomEvent('beuve-token-click', { detail: clicked, bubbles: true, composed: true }),
      );
    }
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

  private readonly onRichSelect = (event: CustomEvent<RichSelectDetail>): void => {
    this.selectRegion(event.detail.target);
  };

  /** The rendered view's margin button: a note on the region, as the gutter button does. */
  private readonly onRichNote = (event: CustomEvent<RichSelectDetail>): void => {
    this.addNote(this.selectRegion(event.detail.target));
  };

  /** A rendered file's link: the web through main, a repository file in a sheet at the head. */
  private readonly onRichLink = (event: CustomEvent<RichLinkDetail>): void => {
    const { target } = event.detail;
    if (target.kind === 'external') {
      this.dispatchEvent(
        new CustomEvent('beuve-open-url', {
          detail: { url: target.href },
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }
    const line = target.line ?? 1;
    const range = { startLine: line, startCharacter: 0, endLine: line, endCharacter: 0 };
    this.dispatchEvent(
      new CustomEvent('beuve-sheet-request', {
        detail: { path: target.path, range },
        bubbles: true,
        composed: true,
      }),
    );
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
      view: ({ view }, event): void => {
        event.stopPropagation();
        if (view === 'rendered' || view === 'source') {
          this.view = view;
        }
      },
      expand: (_data, event): void => {
        this.expand(event);
      },
      'open-sheet': (_data, event): void => {
        event.stopPropagation();
        this.emitSheetRequest();
      },
      'thread-open': ({ url = '' }, event): void => {
        event.stopPropagation();
        this.emitOpenUrl(url);
      },
      link: ({ url = '' }, event): void => {
        // A link in a comment never navigates the window; main opens what it allows (ADR 0040).
        event.preventDefault();
        event.stopPropagation();
        this.emitOpenUrl(url);
      },
      'reveal-note': ({ uraItemId = '' }, event): void => {
        event.stopPropagation();
        this.revealNote(uraItemId);
      },
      'edit-note': ({ uraItemId = '' }): void => {
        this.emitNoteEdit(uraItemId);
      },
      'delete-note': ({ uraItemId = '' }, event): void => {
        event.stopPropagation();
        this.emitNoteDelete(uraItemId);
      },
      'annotation-toggle': (_data, event, element): void => {
        event.stopPropagation();
        this.toggleAnnotation(element, undefined);
      },
      'insight-stage': (_data, _event, button): void => {
        this.emitInsight(button, 'beuve-insight-stage');
      },
      'insight-show': (_data, _event, button): void => {
        this.emitInsight(button, 'beuve-insight-show-in-chat');
      },
    },
    dblclick: {
      note: ({ uraItemId = '' }): void => {
        this.emitNoteEdit(uraItemId);
      },
    },
    keydown: {
      'annotation-toggle': (_data, event, element): void => {
        this.onAnnotationKey(event, element);
      },
    },
  } satisfies DelegatedActions;

  /** The ⌘/Ctrl tracking that shows the pointer on tokens, while the card is in the document. */
  /** Context the reviewer revealed for notes outside the hunks, until the file changes. */
  /** The change runs of the file's patch, for the rendered view's statuses. */
  private runs: readonly ChangeRun[] = [];
  private richPairFile: DiffFileView | undefined;

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
  /** Reads a repository image for a rendered file (ADR 0123). */
  @property({ attribute: false }) accessor loadImage: ImageLoader | undefined;
  /** The session's URA items; staged ones placed on this file get markers. */
  @property({ attribute: false }) accessor uraItems: readonly UraItemView[] = [];
  /** `/review` findings on this file's lines, not yet staged (ADR 0061); empty when hidden. */
  @property({ attribute: false }) accessor insights: readonly ReviewInsight[] = noInsights;
  /** Other reviewers' threads on this file (ADR 0140); none while they are off. */
  @property({ attribute: false }) accessor reviewThreads: readonly ReviewThreadView[] = noThreads;
  /** The head the card shows, which decides whether a thread's lines are this card's lines. */
  @property() accessor headSha = '';
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
  /** Generated or `-diff` (ADR 0052): labeled, and dimmed while collapsed. */
  @property({ type: Boolean, reflect: true }) accessor generated = false;
  /**
   * The file's reviewed mark (ADR 0064): a check when `yes` (the stream collapses the card), a
   * quiet "changed since reviewed" tag when its diff moved on since the mark.
   */
  @property({ reflect: true }) accessor reviewed: FileReviewStateView = 'no';

  @state() accessor isFallback = false;
  /** `@pierre/diffs`, loaded with the first card that mounts (ADR 0025). */
  @state() accessor library: typeof Diffs | undefined;
  /** A file with a rich view (ADR 0123) shows rendered unless the reviewer chose its source. */
  @state() accessor view: 'rendered' | 'source' = 'source';
  /** Both sides of a rendered file, read through `loadFilePair`. */
  @state() accessor richPair: FilePairView | undefined;
  /** The region the rendered view outlines: the selection, a jump's line or the focused hunk. */
  @state() accessor richSelected: RegionTarget | undefined;

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
        this.diff?.cleanUp();
        this.diff = undefined;
        this.unobserveCode();
      },
    });
  }

  /** A rendered row by head line (base line for deletions), on the head side when split. */
  /** Asks the window to open a web page through main (ADR 0040). */
  private emitOpenUrl(url: string): void {
    this.dispatchEvent(
      new CustomEvent('beuve-open-url', { detail: { url }, bubbles: true, composed: true }),
    );
  }

  /** Open in Sheet from the header (ADR 0128): the file at the session head, from its top. */
  private emitSheetRequest(): void {
    const path = this.file?.path;
    if (path === undefined) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent('beuve-sheet-request', {
        detail: { path },
        bubbles: true,
        composed: true,
      }),
    );
  }

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
    let annotations = headSideAnnotationsFrom(this.shownLines(), this.notes());
    if (!isNew && !changed.has('file') && !changed.has('library')) {
      annotations = this.underExpandedLines(annotations);
    }
    const isNewInput = [
      'file',
      'mounted',
      'library',
      'uraItems',
      'insights',
      'reviewThreads',
      'headSha',
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

  /**
   * Notes on lines the reviewer expanded with the separators' own buttons sit under those lines
   * too, not above the gap they came from: the composer of Add Note on expanded lines among them
   * (ADR 0162). Only a diff already on screen knows what is expanded.
   */
  private underExpandedLines(
    annotations: readonly HeadSideAnnotation<CardSlot>[],
  ): HeadSideAnnotation<CardSlot>[] {
    const { diff } = this;
    return annotations.map((annotation) => {
      const { note, placement } = annotation.metadata;
      if (
        diff === undefined ||
        placement.kind !== 'hidden' ||
        diff.isLineInCollapsedContext(note.lineEnd, 'additions')
      ) {
        return annotation;
      }
      const after = note.lineEnd;
      return {
        ...annotation,
        lineNumber: after,
        metadata: { note, placement: { kind: 'shown', after } },
      };
    });
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

  /** Double-click on a staged note's marker, or its Edit button: the stream opens it in the composer. */
  private emitNoteEdit(itemId: string): void {
    if (itemId === '') {
      return;
    }
    const detail: NoteEditDetail = { itemId };
    this.dispatchEvent(
      new CustomEvent('beuve-note-edit', { detail, bubbles: true, composed: true }),
    );
  }

  /** The delete button on a staged note's head: the review deletes it, with the Undo notice (ADR 0144). */
  private emitNoteDelete(itemId: string): void {
    if (itemId === '') {
      return;
    }
    const detail: UraDeleteDetail = { itemIds: [itemId] };
    this.dispatchEvent(
      new CustomEvent('beuve-ura-delete', { detail, bubbles: true, composed: true }),
    );
  }

  /** The markers this card shows: all but the note its composer is editing, which takes its place. */
  private shownMarkers(path: string): UraMarker[] {
    const editedId = this.composer?.edit?.itemId;
    return uraMarkersFrom(path, this.uraItems).filter(({ item }) => item.id !== editedId);
  }

  /** Staged URA markers first, then the composer, each under its last line. */
  private notes(): CardSlot[] {
    const path = this.file?.path ?? '';
    const slots: CardSlot[] = [
      ...this.shownMarkers(path).map(({ lineStart, lineEnd, item }): CardSlot => {
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
      ...this.threadPlacement().inline.map((thread): CardSlot => {
        return {
          lineStart: thread.startLine ?? 0,
          lineEnd: thread.endLine ?? 0,
          note: { kind: 'thread', thread },
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
    this.isGutterLabeled = false;
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
        parseDiffOptions: { preferredDiffLib: '@pierre/patches' },
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
            this.adoptDiffTints();
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
    this.isGutterLabeled = true;
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

  private noteElement({ note: slot, placement }: PlacedSlot): HTMLElement {
    const { note } = slot;
    switch (note.kind) {
      case 'ura': {
        return this.noteNode(note.item, outsideLabel(slot, placement));
      }
      case 'insight': {
        return this.insightNode(note.insight);
      }
      case 'thread': {
        return createThreadAnnotation(note.thread, this.isOpen(`thread:${note.thread.id}`));
      }
      case 'composer': {
        return this.composerNode();
      }
    }
  }

  /** Other reviewers' threads split between the diff and the card's list (ADR 0140). */
  private threadPlacement(): ThreadPlacement {
    return placeReviewThreads(this.reviewThreads, this.headSha);
  }

  /** Whether the reviewer opened the annotation `key` (ADR 0155); it stays open across re-renders. */
  private isOpen(key: string): boolean {
    return this.openAnnotations.has(key);
  }

  /** A note's annotation, which a click opens in the editor. */
  private noteNode(item: UraItemView, outside: string | undefined): HTMLElement {
    return createNoteAnnotation(item, { ...(outside !== undefined && { outside }) });
  }

  /** A `/review` finding's annotation, open if the reviewer left it open. */
  private insightNode(insight: ReviewInsight): HTMLElement {
    return createInsightElement(insight, this.isOpen(`insight:${insight.key}`));
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

  /**
   * Opens or closes (`undefined`: toggles) the annotation `element` is in, an insight or a thread
   * (ADR 0155), and remembers it. A note opens in the editor instead.
   */
  private toggleAnnotation(element: HTMLElement, isOpen: boolean | undefined): void {
    const root = element.closest<HTMLElement>('[data-annotation-key]');
    const key = root?.dataset['annotationKey'];
    if (root === null || key === undefined) {
      return;
    }
    const isOpening = isOpen ?? !root.classList.contains('open');
    const [kind = '', id = ''] = splitKey(key);
    if (kind === 'insight') {
      const insight = this.insights.find((candidate) => candidate.key === id);
      if (insight === undefined) {
        return;
      }
      setInsightOpen(root, insight, isOpening);
    } else {
      const thread = this.reviewThreads.find((candidate) => candidate.id === id);
      if (thread === undefined) {
        return;
      }
      setThreadOpen(root, thread, isOpening);
    }
    if (isOpening) {
      this.openAnnotations.add(key);
    } else {
      this.openAnnotations.delete(key);
    }
  }

  /** Enter or Space on an annotation's toggle opens or closes it; Escape closes it (ADR 0155). */
  private onAnnotationKey(event: KeyboardEvent, element: HTMLElement): void {
    const root = element.closest<HTMLElement>('[data-annotation-key]');
    const toggle = root?.querySelector<HTMLElement>('.annotation-toggle');
    const isOpen = root?.classList.contains('open') === true;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      this.toggleAnnotation(element, !isOpen);
    } else if (isOpen && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.toggleAnnotation(element, false);
      toggle?.focus({ preventScroll: true });
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

  /**
   * The diff library blends a changed line's color into the background (12% light, 20% dark) but
   * paints a changed word's color as given, so the tokens' line < number < word steps came out as
   * a near-invisible line under a strong word. Turning that blend off makes the line, gutter and
   * word colors the `--beuve-diff-*` tokens themselves; a selection layers over them
   * ({@link diffSelectionCss}, ADR 0114 amendments).
   */
  private adoptDiffTints(): void {
    const root = this.renderRoot.querySelector('diffs-container')?.shadowRoot;
    if (root === undefined || root === null) {
      return;
    }
    if (this.tintSheet === undefined) {
      this.tintSheet = new CSSStyleSheet();
      this.tintSheet.replaceSync(
        `[data-line], [data-no-newline], [data-gutter-buffer], [data-column-number] { --mix-light: 0%; --mix-dark: 0%; }\n${diffSelectionCss}`,
      );
    }
    if (!root.adoptedStyleSheets.includes(this.tintSheet)) {
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, this.tintSheet];
    }
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

  /**
   * One composer element per card, kept while it is open so typing survives re-renders; editing
   * another staged note, or a new one, starts a fresh element from that note's text.
   */
  private composerNode(): BeuveUraComposer {
    let element = this.composerElement;
    if (element === undefined) {
      element = document.createElement('beuve-ura-composer');
      element.draft = this.composer?.edit?.draft;
      this.composerElement = element;
    }
    this.syncComposer();
    return element;
  }

  private syncComposer(): void {
    const { composer, composerElement } = this;
    if (composerElement === undefined) {
      return;
    }
    if (
      composer === undefined ||
      composer.path !== this.file?.path ||
      composerElement.draft !== composer.edit?.draft
    ) {
      this.composerElement = undefined;
      return;
    }
    composerElement.where = composer.where;
    composerElement.anchor = composer.anchor;
    composerElement.placement = '';
    if (isOutsideHunks(composer.anchor, this.file.hunks)) {
      composerElement.placement = 'Outside the diff: on GitHub it goes in the review body.';
    }
    composerElement.suggestions = composer.suggestions;
    composerElement.saving = composer.saving;
    composerElement.error = composer.error;
  }

  /**
   * A new file: a different path opens rendered when it has a rich view (ADR 0123), the same
   * path keeps the reviewer's choice; either way its runs and sides are read again.
   */
  private syncRichFile(previous: DiffFileView | undefined): void {
    const { file } = this;
    if (file?.path !== previous?.path) {
      this.view = 'source';
      if (file !== undefined && richViewKindFrom(file.path) !== undefined) {
        this.view = 'rendered';
      }
      this.richSelected = undefined;
    }
    this.runs = changeRunsFrom(file?.patch ?? '');
    this.richPair = undefined;
    this.richPairFile = undefined;
  }

  /** Whether this card shows its file rendered (ADR 0123) rather than as a diff. */
  private isRendered(): boolean {
    const { file } = this;
    return (
      file !== undefined &&
      this.view === 'rendered' &&
      !file.binary &&
      richViewKindFrom(file.path) !== undefined
    );
  }

  /** Selects a rendered region's lines as the card's target, and outlines it. */
  private selectRegion(target: RegionTarget): SelectedLines {
    const side = librarySides[target.side];
    const range: SelectedLines = {
      start: target.lines.start,
      end: target.lines.end,
      side,
      endSide: side,
    };
    this.lineSelection = range;
    this.focusedLine = undefined;
    this.clickedToken = undefined;
    this.richSelected = target;
    return range;
  }

  private async loadRichPair(file: DiffFileView): Promise<void> {
    this.richPairFile = file;
    const pair = await this.loadFilePair?.(file.path);
    if (this.file !== file) {
      return;
    }
    if (pair === undefined) {
      this.view = 'source';
      return;
    }
    this.richPair = pair;
  }

  /** The rendered file, with the card's notes slotted under their regions. */
  private renderRich(file: DiffFileView): TemplateResult {
    const pair = this.richPair;
    if (pair === undefined) {
      return html`<p class="empty">Rendering ${pathText(file.path)}…</p>`;
    }
    const slots = this.notes();
    const annotations = slots.map((slot, index): RichAnnotation => {
      return { slot: `note-${String(index)}`, line: slot.lineEnd };
    });
    return html`<beuve-rich-view
      .path=${file.path}
      .basePath=${file.oldPath ?? file.path}
      .head=${pair.newContents}
      .base=${pair.oldContents}
      .runs=${this.runs}
      .annotations=${annotations}
      .selected=${this.active ? this.richSelected : undefined}
      .loadImage=${this.loadImage}
      showsRemoved
      canNote
      @beuve-rich-select=${this.onRichSelect}
      @beuve-rich-note=${this.onRichNote}
      @beuve-rich-link=${this.onRichLink}
      >${slots.map((slot, index) => {
        return html`<div slot=${`note-${String(index)}`}>${this.richNoteElement(slot.note)}</div>`;
      })}</beuve-rich-view
    >`;
  }

  private richNoteElement(note: CardNote): HTMLElement {
    switch (note.kind) {
      case 'ura': {
        return this.noteNode(note.item, undefined);
      }
      case 'insight': {
        return this.insightNode(note.insight);
      }
      case 'thread': {
        return createThreadAnnotation(note.thread, this.isOpen(`thread:${note.thread.id}`));
      }
      case 'composer': {
        return this.composerNode();
      }
    }
  }

  /**
   * Comments of other reviewers that are not on lines this card shows (another side or commit,
   * outdated, or on the whole file): collapsed, so nothing is placed where it may not belong.
   */
  private renderAsideThreads(): TemplateResult | typeof nothing {
    const { aside } = this.threadPlacement();
    if (aside.length === 0) {
      return nothing;
    }
    return html`<details class="threads-aside">
      <summary>
        ${countNoun(aside.length, 'comment thread')} from other reviewers, not on these lines
      </summary>
      ${aside.map((thread) => {
        return createThreadElement(thread, { showsPlace: true });
      })}
    </details>`;
  }

  /** Open in Sheet; a deleted or binary file has nothing to show at the head. */
  private renderSheetButton(file: DiffFileView): TemplateResult | typeof nothing {
    if (file.status === 'deleted' || file.binary) {
      return nothing;
    }
    return html`<button
      class="button quiet icon"
      type="button"
      aria-label="Open in Sheet"
      title="Open in Sheet"
      data-action="open-sheet"
    >
      ${displayIcon('pop-out')}
    </button>`;
  }

  /** Rendered and Source, for a file with a rich view. */
  private renderViewToggle(file: DiffFileView): TemplateResult | typeof nothing {
    if (file.binary || richViewKindFrom(file.path) === undefined || this.collapsed) {
      return nothing;
    }
    const isRendered = this.view === 'rendered';
    return html`<span class="segmented view-toggle" role="radiogroup" aria-label="Show the file">
      <button
        type="button"
        role="radio"
        aria-checked=${isRendered ? 'true' : 'false'}
        data-action="view"
        data-view="rendered"
      >
        Rendered
      </button>
      <button
        type="button"
        role="radio"
        aria-checked=${isRendered ? 'false' : 'true'}
        data-action="view"
        data-view="source"
      >
        Source
      </button>
    </span>`;
  }

  private rich(): BeuveRichView | undefined {
    return this.renderRoot.querySelector('beuve-rich-view') ?? undefined;
  }

  /** Scrolls `target` into view in the rendered view (the card's header without one), mounting it. */
  private async revealRegion(target: RegionTarget | undefined): Promise<RegionTarget | undefined> {
    this.mounted = true;
    await this.updateComplete;
    if (target === undefined) {
      this.scrollIntoView({ block: 'start' });
      return undefined;
    }
    const rich = await waitForValue(() => this.rich());
    return rich?.reveal(target);
  }

  /** Reveals `target` and outlines its region: a jump, a find hit or a hunk step. */
  private async focusRegion(target: RegionTarget | undefined): Promise<void> {
    const region = await this.revealRegion(target);
    this.richSelected = region ?? target;
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
    if (this.mounted && this.isRendered()) {
      return this.renderRich(file);
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
    return html`${this.shownMarkers(path).map((marker) => this.noteNode(marker.item, undefined))}
      ${this.insights.map((insight) => this.insightNode(insight))}
      ${this.composer?.path === path ? this.composerNode() : nothing}
      <pre>
${splitPatch(file.patch).map((line) => {
          return html`<span class="line ${line.kind}">${line.text === '' ? ' ' : line.text}</span>`;
        })}</pre>`;
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

  /** The library's shadow root, which holds the code rows, once the diff has rendered. */
  codeRoot(): ShadowRoot | undefined {
    return this.renderRoot.querySelector('diffs-container')?.shadowRoot ?? undefined;
  }

  /** Toggle Rendered View (ADR 0123): rendered or source, for a file with a rich view. */
  toggleView(): void {
    const { file } = this;
    if (file === undefined || file.binary || richViewKindFrom(file.path) === undefined) {
      return;
    }
    if (this.view === 'rendered') {
      this.view = 'source';
    } else {
      this.view = 'rendered';
    }
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
    if (this.isRendered()) {
      const librarySide = librarySides[side];
      await this.focusRegion({ side, lines: { start, end } });
      this.lineSelection = { start, end, side: librarySide, endSide: librarySide };
      this.focusedLine = undefined;
      return;
    }
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

  /**
   * Runs the card's action for a click, double-click or key event that the diff stream's
   * delegated listener caught on this card (ADR 0074).
   */
  runAction(event: Event): void {
    const type = event.type as 'click' | 'dblclick' | 'keydown';
    const handlers = (this.actions as DelegatedActions)[type];
    dispatchAction(event, this.renderRoot, handlers as ActionHandlers<Event> | undefined);
  }

  /** A pointer moved over the card: the library attaches its gutter button on hover, labeled once per diff. */
  notePointerMove(): void {
    if (!this.isGutterLabeled) {
      this.labelGutterButton();
    }
  }

  /** Scrolls to head line `line` and makes it the card's target (a citation or flow jump). */
  async focusLine(line: number): Promise<void> {
    if (this.isRendered()) {
      await this.focusRegion({ side: 'head', lines: { start: line, end: line } });
      this.lineSelection = undefined;
      this.clickedToken = undefined;
      this.focusedLine = line;
      return;
    }
    await this.revealLine(line);
    // eslint-disable-next-line unicorn/no-null -- the library clears the selection with null.
    this.diff?.setSelectedLines(null);
    this.lineSelection = undefined;
    this.clickedToken = undefined;
    this.focusedLine = line;
  }

  /** Scrolls head line `line` into view (or the card's header without one), mounting the diff. */
  async revealLine(line: number | undefined): Promise<void> {
    if (this.isRendered()) {
      let target: RegionTarget | undefined;
      if (line !== undefined) {
        target = { side: 'head', lines: { start: line, end: line } };
      }
      await this.revealRegion(target);
      return;
    }
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
    if (this.isRendered()) {
      this.activeHunk = index;
      const hunk = this.file?.hunks[index];
      let target: RegionTarget | undefined;
      if (hunk !== undefined) {
        target = hunkTargetFrom(hunk, this.runs);
      }
      await this.focusRegion(target);
      return;
    }
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
    if (changed.has('diffStyle') && this.diff !== undefined) {
      this.diff.cleanUp();
      this.diff = undefined;
      this.codeGeneration += 1;
      this.measuredHeight = undefined;
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
      this.syncRichFile(changed.get('file'));
    }
    if (changed.has('view') && this.view === 'rendered' && this.diff !== undefined) {
      this.unobserveCode();
      this.diff.cleanUp();
      this.diff = undefined;
    }
    if (
      this.mounted &&
      this.file !== undefined &&
      this.richPairFile !== this.file &&
      this.isRendered()
    ) {
      void this.loadRichPair(this.file);
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
    const { library, metadata } = this;
    if (
      library === undefined ||
      metadata === undefined ||
      this.isRendered() ||
      !this.mounted ||
      this.collapsed ||
      this.isFallback
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
      this.adoptDiffTints();
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
          ${this.renderViewToggle(file)} ${this.renderSheetButton(file)}
        </div>
      </div>
      ${this.renderAsideThreads()}
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

/** An annotation key's kind and id: `ura:<id>`, `insight:<key>` or `thread:<id>`. */
function splitKey(key: string): string[] {
  const at = key.indexOf(':');
  return [key.slice(0, at), key.slice(at + 1)];
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
      preferredDiffLib: '@pierre/patches',
      // Spans then carry their column, which Go to Definition needs from a click.
      useTokenTransformer: true,
      langs: [],
    },
  );
}

const checkIcon: SVGTemplateResult = svg`<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 7.2 6 9.6l4.6-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** Parses the patch, keyed by its blobs and hunks, picks a grammar from the `#!` line when the name gives none, and turns highlighting off for languages beuve doesn't ship. */
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
  // A name with no extension can still name its interpreter: `bin/deploy` (ADR 0120).
  return library.setLanguageOverride(metadata, languageFromShebang(file.shebang) ?? 'text');
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
