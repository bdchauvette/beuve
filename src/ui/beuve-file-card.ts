import type * as Diffs from '@pierre/diffs';
import type { FileDiff, FileDiffLoadedFiles, FileDiffMetadata } from '@pierre/diffs';
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
  FileImpactView,
  FileReviewStateView,
  FilePairView,
  ImpactFindingView,
  UraAnchorView,
  UraItemView,
} from '#contract/ipc-contract.ts';
import { revealFormatControls } from '#x/text/reveal-format-controls.ts';

import './beuve-flow-portal.ts';
import type { FlowNodeActivateDetail } from './flow-graph-view.ts';
import './beuve-peek-portal.ts';
import './beuve-trace-portal.ts';
import type { TraceLineActivateDetail } from './beuve-trace-portal.ts';
import './beuve-ura-composer.ts';
import type { BeuveUraComposer } from './beuve-ura-composer.ts';
import { applySuggestedPatch } from './apply-suggested-patch.ts';
import { buildSuggestedPatch } from './build-suggested-patch.ts';
import { describeUraItem } from './describe-ura-item.ts';
import { headRowSelector } from './head-row-selector.ts';
import { highlightedLanguages } from './highlighted-languages.ts';
import type { FlowState } from './flow-state.ts';
import type { PeekState } from './peek-state.ts';
import type { TraceState } from './trace-state.ts';
import { editTargetFrom } from './edit-target-from.ts';
import type { EditTarget } from './edit-target-from.ts';
import { planImpactChip } from './plan-impact-chip.ts';
import type { ImpactChip } from './plan-impact-chip.ts';
import { planHunkSteps } from './plan-hunk-steps.ts';
import { planStepHighlight } from './plan-step-highlight.ts';
import type { HunkStep } from './plan-hunk-steps.ts';
import type { DiffDeferral } from './plan-diff-deferrals.ts';
import { mentionFromTarget } from './mention-from-target.ts';
import { targetFrom } from './target-from.ts';
import type { ReviewTarget, SelectedLines } from './target-from.ts';
import { splitPatch } from './split-patch.ts';
import { headSideAnnotationsFrom } from './head-side-annotations-from.ts';
import { diffsThemeNames } from './diffs-theme-names.ts';
import { loadDiffsLibrary } from './load-diffs-library.ts';
import { parseInlineTitle } from './parse-inline-title.ts';
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

const noInsights: readonly ReviewInsight[] = [];

const estimatedLineHeight = 20;
const estimatedSeparatorHeight = 32;

/**
 * One file of the review diff (ADR 0018, 0025): a header with its status, path and line counts,
 * the ImpactGate banner once the impact check has run, the call-stack peek portal while it is
 * open, and the patch rendered by `@pierre/diffs` with Alabaster-style highlighting. The diff mounts while the stream sets `mounted` (the card is near
 * the viewport); otherwise a placeholder of the diff's last or estimated height stands in. If the
 * library fails to render, the card falls back to a plain `<pre>` of the patch. Staged URA items
 * show as subtle markers under their lines, the Add Note composer opens under the lines it stages,
 * and the ImpactGate banner offers to stage its findings. Emits `beuve-diff-rendered` each time
 * its diff mounts and `beuve-ura-stage-finding` from the banner.
 */
@customElement('beuve-file-card')
export class BeuveFileCard extends LitElement {
  static override styles = [
    formatControlStyles,
    css`
      :host {
        display: block;
        border: 1px solid var(--beuve-border);
        border-radius: var(--beuve-radius);
        background: var(--beuve-code-bg);
        overflow: clip;
      }

      :host([active]) {
        border-color: var(--beuve-accent);
        box-shadow: 0 0 0 1px var(--beuve-accent);
      }

      .header {
        position: sticky;
        top: calc(-1 * var(--beuve-space-3));
        z-index: 2;
      }

      .title {
        display: flex;
        align-items: center;
        gap: var(--beuve-space-2);
        padding: var(--beuve-space-2) var(--beuve-space-3);
        border-bottom: 1px solid var(--beuve-border);
        background: var(--beuve-surface-sunken);
      }

      .path {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        font: var(--beuve-font-mono);
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .old-path {
        color: var(--beuve-text-muted);
      }

      .status {
        padding: 0 var(--beuve-space-1);
        border: 1px solid var(--beuve-border);
        border-radius: 4px;
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
        text-transform: uppercase;
      }

      .counts {
        display: inline-flex;
        flex: none;
        gap: var(--beuve-space-1);
        justify-content: flex-end;
        min-width: 11ch;
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

      .impact-chip {
        display: inline-flex;
        flex: none;
        align-items: center;
        gap: 4px;
        padding: 0 var(--beuve-space-1);
        border: 1px solid transparent;
        border-radius: 4px;
        background: transparent;
        color: var(--beuve-text-muted);
        font: var(--beuve-font-small);
        cursor: default;
      }

      .impact-chip svg {
        width: 12px;
        height: 12px;
      }

      .impact-chip.quiet {
        opacity: 0.55;
      }

      .impact-chip.warning {
        border-color: color-mix(in srgb, var(--beuve-warn) 45%, transparent);
        background: color-mix(in srgb, var(--beuve-warn) 10%, var(--beuve-surface-sunken));
        color: var(--beuve-warn);
      }

      .impact-chip:hover,
      .impact-chip:focus-visible {
        opacity: 1;
        border-color: var(--beuve-accent);
        outline: none;
      }

      .impact-popover {
        position: fixed;
        inset: auto;
        box-sizing: border-box;
        width: min(380px, calc(100vw - 32px));
        margin: 0;
        padding: var(--beuve-space-2) var(--beuve-space-3);
        border: 1px solid var(--beuve-border);
        border-radius: var(--beuve-radius);
        background: var(--beuve-surface);
        box-shadow: 0 6px 24px #0000001f;
        color: var(--beuve-text);
        font: var(--beuve-font-small);
      }

      .impact-popover h3 {
        margin: 0 0 var(--beuve-space-1);
        font: inherit;
        font-weight: 600;
      }

      .impact-popover p {
        margin: 0 0 var(--beuve-space-1);
        color: var(--beuve-text-muted);
      }

      .impact-popover table {
        width: 100%;
        margin-bottom: var(--beuve-space-1);
        border-collapse: collapse;
      }

      .impact-popover th {
        padding: 2px 0;
        font-weight: 400;
        text-align: left;
        color: var(--beuve-text-muted);
      }

      .impact-popover td {
        padding: 2px 0;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }

      .impact-popover th:not(:first-child),
      .impact-popover td:not(:first-child) {
        padding-left: var(--beuve-space-2);
        text-align: right;
      }

      .impact-popover .fn {
        max-width: 160px;
        overflow: hidden;
        font: var(--beuve-font-mono);
        font-size: 11px;
        text-overflow: ellipsis;
      }

      .impact-popover .breach {
        color: var(--beuve-warn);
      }

      .impact-popover .actions {
        display: flex;
        align-items: center;
        gap: var(--beuve-space-2);
      }

      .impact-popover .keys {
        flex: 1;
        color: var(--beuve-text-muted);
      }

      .impact-popover button {
        padding: 0 var(--beuve-space-2);
        border: 1px solid var(--beuve-border);
        border-radius: 4px;
        background: var(--beuve-surface);
        color: var(--beuve-text);
        font: inherit;
        cursor: pointer;
      }

      .impact-popover button:disabled {
        color: var(--beuve-text-muted);
        cursor: default;
      }

      .edit-bar {
        display: flex;
        align-items: baseline;
        gap: var(--beuve-space-2);
        padding: var(--beuve-space-1) var(--beuve-space-3);
        border-bottom: 1px solid var(--beuve-border);
        border-left: 3px solid var(--beuve-accent);
        background: var(--beuve-surface);
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      .edit-bar .what {
        font-weight: 600;
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
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        padding: 0 var(--beuve-space-1);
        border-radius: 4px;
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
        width: 14px;
        height: 14px;
        padding: 0;
        border: none;
        background: none;
        color: var(--beuve-ok);
        cursor: pointer;
      }

      .reviewed-mark svg {
        width: 100%;
        height: 100%;
      }

      :host([reviewed='yes'][collapsed]) .title {
        cursor: pointer;
      }

      .changed-since {
        flex: 0 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        padding: 0 var(--beuve-space-1);
        border: 1px dashed var(--beuve-border);
        border-radius: 4px;
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      :host([reviewed='yes'][collapsed]) .title {
        border-bottom-color: transparent;
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

      .collapsed-body button {
        padding: 0 var(--beuve-space-2);
        border: 1px solid var(--beuve-border);
        border-radius: 4px;
        background: var(--beuve-surface);
        color: var(--beuve-text);
        font: inherit;
        cursor: pointer;
      }

      .collapsed-body button:hover,
      .collapsed-body button:focus-visible {
        border-color: var(--beuve-accent);
        outline: none;
      }

      .collapsed-body kbd {
        font: var(--beuve-font-mono);
        font-size: 11px;
      }

      .empty {
        margin: 0;
        padding: var(--beuve-space-2) var(--beuve-space-3);
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      diffs-container {
        --diffs-font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
        --diffs-font-size: 12px;
        --diffs-line-height: 20px;
        --diffs-header-font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
        --diffs-bg-context-override: var(--beuve-code-bg);
        --diffs-bg-buffer-override: var(--beuve-code-bg);
        --diffs-bg-separator-override: var(--beuve-surface-sunken);
        --diffs-bg-context-gutter-override: var(--beuve-code-bg);
        --diffs-fg-number-override: var(--beuve-text-muted);
        --diffs-bg-addition-override: var(--beuve-diff-added-bg);
        --diffs-bg-addition-number-override: var(--beuve-diff-added-bg);
        --diffs-bg-addition-emphasis-override: var(--beuve-diff-added-emphasis);
        --diffs-bg-deletion-override: var(--beuve-diff-removed-bg);
        --diffs-bg-deletion-number-override: var(--beuve-diff-removed-bg);
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
        margin: 2px var(--beuve-space-3);
        padding: 0 var(--beuve-space-2);
        border-left: 2px solid var(--beuve-accent);
        font: var(--beuve-font-small);
        white-space: nowrap;
        color: var(--beuve-text-muted);
      }

      .ura-marker .ura-kind {
        flex: none;
        font-weight: 600;
        color: var(--beuve-accent);
      }

      .ura-marker.blocker {
        border-left-color: var(--beuve-danger);
      }

      .ura-marker.blocker .ura-kind {
        color: var(--beuve-danger);
      }

      .ura-marker .ura-title {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        color: var(--beuve-text);
      }

      .ura-marker .ura-title code {
        padding: 0 2px;
        border-radius: 3px;
        background: var(--beuve-surface-sunken);
        font: var(--beuve-font-mono);
      }

      .insight-badge {
        color: var(--beuve-text-muted);
      }

      .insight {
        --insight-color: var(--beuve-text-muted);
        margin: 2px var(--beuve-space-3);
        padding: 0 var(--beuve-space-2);
        border-left: 2px solid var(--insight-color);
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
        min-width: 0;
        white-space: nowrap;
        cursor: pointer;
        outline: none;
      }

      .insight-line:focus-visible {
        outline: 1px solid var(--beuve-accent);
        outline-offset: 1px;
      }

      .insight-category {
        flex: none;
        color: var(--insight-color);
      }

      .insight-title {
        min-width: 0;
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
        padding: 0 2px;
        border-radius: 3px;
        background: var(--beuve-surface-sunken);
        font: var(--beuve-font-mono);
      }

      .insight-body {
        padding: var(--beuve-space-1) 0 var(--beuve-space-2);
        color: var(--beuve-text);
        white-space: normal;
      }

      .insight-text p,
      .insight-text ul {
        margin: 0 0 var(--beuve-space-1);
      }

      .insight-text ul {
        padding-left: var(--beuve-space-4);
      }

      .insight-text pre {
        margin: 0 0 var(--beuve-space-1);
        padding: var(--beuve-space-1) var(--beuve-space-2);
        border-radius: 3px;
        background: var(--beuve-surface-sunken);
        overflow-x: auto;
      }

      .insight-actions {
        display: flex;
        align-items: baseline;
        gap: var(--beuve-space-2);
        color: var(--beuve-text-muted);
      }

      .insight-actions button {
        padding: 0 var(--beuve-space-2);
        border: 1px solid var(--beuve-border);
        border-radius: 4px;
        background: var(--beuve-surface);
        color: var(--beuve-text);
        font: inherit;
        cursor: pointer;
      }

      .insight-actions button:hover,
      .insight-actions button:focus-visible {
        border-color: var(--beuve-accent);
        outline: none;
      }

      pre {
        margin: 0;
        padding: var(--beuve-space-1) 0;
        overflow-x: auto;
        font: var(--beuve-font-mono);
      }

      .line {
        display: block;
        min-width: max-content;
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

  private diff: FileDiff<CardSlot> | undefined;
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
  /** The head line a jump (citation, flow node, trace line) landed on, until Next/Previous Change moves on. */
  private focusedLine: number | undefined;
  /** The Suggest Edit editor attached to the diff, and the head text it started from. */
  private editor: Editor<'file-diff', CardSlot> | undefined;
  private editHead: string | undefined;
  /** Insight notes the reviewer expanded, by insight key. */
  private readonly openInsights = new Set<string>();
  /** The gutter marks' style sheet in this diff's shadow root. */
  private markSheet: CSSStyleSheet | undefined;
  /** Whether this diff's gutter button already shows the chat icon. */
  private isGutterLabelled = false;
  /** Bumped to give the diff a fresh container: after an edit, or a layout change. */
  private codeGeneration = 0;
  private impactHideTimer: ReturnType<typeof setTimeout> | undefined;
  /** The chip's top edge when the popover was placed. */
  private impactAnchorTop = 0;
  /**
   * The popover is placed once from the chip's rectangle and closes, calmly, when a scroll moves
   * the chip away from it; scrolling inside the popover or sideways in the code leaves it be.
   */
  private readonly onScrollWhileImpactOpen = (event: Event): void => {
    const parts = this.impactParts();
    if (parts === undefined) {
      return;
    }
    const isInside = event.target instanceof Node && parts.popover.contains(event.target);
    if (!isInside && Math.abs(parts.chip.getBoundingClientRect().top - this.impactAnchorTop) > 1) {
      this.hideImpact();
    }
  };

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

  private readonly onTraceLineActivate = (event: CustomEvent<TraceLineActivateDetail>): void => {
    event.stopPropagation();
    void this.focusLine(event.detail.line);
  };

  private readonly onLineSelected = (range: SelectedLines | null): void => {
    if (range === null) {
      this.lineSelection = undefined;
      return;
    }
    const step = this.programmaticStep;
    const isStep =
      range.start === step?.start &&
      range.end === step.end &&
      (range.side ?? 'additions') === step.side;
    this.lineSelection = isStep ? undefined : range;
    if (!isStep) {
      this.focusedLine = undefined;
    }
  };

  /**
   * The card's actions (ADR 0074), which the diff stream's listeners run through {@link runAction}:
   * a card adds no click or key listener of its own. Focus and hover moves inside a card never
   * reach the stream (their related target is in the same shadow root), so the `crossing` ones
   * are delegated to the card's own root, and only while it shows an ImpactGate chip or insights.
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
      'impact-chip': (_data, event): void => {
        event.stopPropagation();
        this.showImpact();
      },
      'impact-popover': (_data, event): void => {
        event.stopPropagation();
      },
      'impact-stage': (_data, event): void => {
        this.stageImpactFindings(event);
      },
      expand: (_data, event): void => {
        this.expand(event);
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
      'impact-chip': (_data, event): void => {
        this.onImpactKey(event);
      },
      'impact-popover': (_data, event): void => {
        this.onImpactKey(event);
      },
      insight: (_data, event, note): void => {
        this.onInsightKey(event, note);
      },
    },
  } satisfies DelegatedActions;

  private readonly crossing = {
    pointerover: {
      'impact-chip': (): void => {
        this.showImpact();
      },
      'impact-popover': (): void => {
        this.showImpact();
      },
    },
    pointerout: {
      'impact-chip': (): void => {
        this.scheduleImpactHide();
      },
      'impact-popover': (): void => {
        this.scheduleImpactHide();
      },
    },
    focusin: {
      'impact-chip': (): void => {
        this.showImpact();
      },
      'impact-popover': (): void => {
        this.showImpact();
      },
      'insight-line': (_data, _event, line): void => {
        if (line.matches(':focus-visible') && line.getAttribute('aria-expanded') !== 'true') {
          this.toggleInsight(line, true);
        }
      },
    },
    focusout: {
      'impact-chip': (): void => {
        this.scheduleImpactHide();
      },
      'impact-popover': (): void => {
        this.scheduleImpactHide();
      },
    },
  } satisfies DelegatedActions;

  /** The {@link crossing} listeners, while the card has something they act on. */
  private crossingDelegation: AbortController | undefined;
  /** The editing keys' listeners, while a Suggest Edit edit is in progress. */
  private editKeys: AbortController | undefined;

  @property({ attribute: false }) accessor file: DiffFileView | undefined;
  @property({ type: Boolean, reflect: true }) accessor active = false;
  /** Set by the diff stream when the card nears the viewport; the diff renders from then on. */
  @property({ type: Boolean, reflect: true }) accessor mounted = false;
  /** This file's ImpactGate entry; `undefined` until the check has run. */
  @property({ attribute: false }) accessor impact: FileImpactView | undefined;
  @property({ attribute: false }) accessor findings: readonly ImpactFindingView[] = [];
  @property({ attribute: false }) accessor peek: PeekState | undefined;
  /** The control-flow graph portal, which shares the peek's place (one portal at a time). */
  @property({ attribute: false }) accessor flow: FlowState | undefined;
  /** The trace timeline portal; it shares the place of the peek and flow portals too. */
  @property({ attribute: false }) accessor trace: TraceState | undefined;
  /** The hunk Next/Previous Change stopped at, selected in the diff; `-1` for none. */
  @property({ type: Number }) accessor activeHunk = -1;
  /** Enables hunk expansion; absent outside Electron. */
  @property({ attribute: false }) accessor loadFilePair: FilePairLoader | undefined;
  /** The session's URA items; staged ones placed on this file get markers. */
  @property({ attribute: false }) accessor uraItems: readonly UraItemView[] = [];
  /** `/review` findings on this file's lines, not yet staged (ADR 0061); empty when hidden. */
  @property({ attribute: false }) accessor insights: readonly ReviewInsight[] = noInsights;
  /** The Add Note composer, when it is open on this file. */
  @property({ attribute: false }) accessor composer: ComposerState | undefined;
  /** How the diff is laid out ({@link planDiffLayout} in the stream, ADR 0042). */
  @property() accessor diffStyle: DiffLayoutView = 'unified';
  /** ImpactGate's cognitive limit, named in the indicator's popover. */
  @property({ type: Number }) accessor cognitiveLimit: number | undefined;
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
        this.endEdit();
        this.diff?.cleanUp();
        this.diff = undefined;
        this.unobserveCode();
        clearTimeout(this.impactHideTimer);
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
    library: typeof Diffs,
    changed: PropertyValues<this>,
    container: HTMLElement,
    metadata: FileDiffMetadata,
  ): void {
    const isNew = this.diff === undefined;
    this.diff ??= this.createDiff(library);
    const annotations = headSideAnnotationsFrom(this.file?.hunks ?? [], this.notes());
    const isNewInput = ['file', 'mounted', 'library', 'uraItems', 'insights', 'composer'].some(
      (key) => changed.has(key as keyof BeuveFileCard),
    );
    if (isNew || isNewInput) {
      this.diff.render({
        fileDiff: metadata,
        containerWrapper: container,
        lineAnnotations: annotations,
      });
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
    const step = this.active
      ? planHunkSteps(metadata.hunks, this.diffStyle)[this.activeHunk]
      : undefined;
    this.programmaticStep = step;
    this.lineSelection = undefined;
    // eslint-disable-next-line unicorn/no-null -- the library clears the selection with null.
    this.diff.setSelectedLines(step ?? null, planStepHighlight(this.diffStyle, step));
  }

  /** Staged URA markers first, then the composer, each under its last line. */
  private notes(): CardSlot[] {
    const path = this.file?.path ?? '';
    const composer = this.composer?.path === path ? this.composer : undefined;
    const composerLines =
      composer?.anchor.kind === 'lines'
        ? { lineStart: composer.anchor.startLine, lineEnd: composer.anchor.endLine }
        : { lineStart: 0, lineEnd: 0 };
    return [
      ...uraMarkersFrom(path, this.uraItems).map(({ lineStart, lineEnd, item }): CardSlot => ({
        lineStart,
        lineEnd,
        note: { kind: 'ura', item },
      })),
      ...this.insights.map((insight): CardSlot => ({
        lineStart: insight.finding.startLine,
        lineEnd: insight.finding.endLine,
        note: { kind: 'insight', insight },
      })),
      ...(composer === undefined
        ? []
        : [{ ...composerLines, note: { kind: 'composer' } } as const]),
    ];
  }

  private createDiff(library: typeof Diffs): FileDiff<CardSlot> {
    this.isGutterLabelled = false;
    const loader = this.loadFilePair;
    return new library.FileDiff<CardSlot>(
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
        enableGutterUtility: true,
        onGutterUtilityClick: (range): void => {
          this.addToChat(range);
        },
        ...(loader !== undefined && {
          loadDiffFiles: async (fileDiff: FileDiffMetadata): Promise<FileDiffLoadedFiles> =>
            loadFiles(loader, fileDiff),
        }),
        renderAnnotation: (annotation): HTMLElement => this.noteElement(annotation.metadata.note),
        onPostRender: (_node, _instance, phase): void => {
          if (phase !== 'mount') {
            return;
          }
          this.syncInsightMarks();
          this.dispatchEvent(
            new CustomEvent('beuve-diff-rendered', { bubbles: true, composed: true }),
          );
        },
      },
      shared.pool,
    );
  }

  /**
   * `@pierre/diffs` shows its gutter button beside the hovered line number, or at the end of the
   * selection; a click adds that line or the selection to the chat, a drag from it selects lines
   * first (ADR 0046). Its plus becomes a speech bubble, so it doesn't read as "stage a note".
   */
  private labelGutterButton(): void {
    const root = this.renderRoot.querySelector('diffs-container')?.shadowRoot;
    const button = root?.querySelector<HTMLElement>('[data-utility-button]');
    if (button === undefined || button === null) {
      return;
    }
    this.isGutterLabelled = true;
    button.title = `Add to Chat (${shortcutOf('add-to-chat', keyPlatformOf(navigator.platform))}); drag to take more lines`;
    button.setAttribute('aria-label', 'Add these lines to the chat');
    const namespace = 'http://www.w3.org/2000/svg';
    const icon = document.createElementNS(namespace, 'svg');
    icon.setAttribute('viewBox', '0 0 16 16');
    icon.setAttribute('width', '12');
    icon.setAttribute('height', '12');
    icon.setAttribute('aria-hidden', 'true');
    const bubble = document.createElementNS(namespace, 'path');
    bubble.setAttribute(
      'd',
      'M3 2.5h10A1.5 1.5 0 0 1 14.5 4v6a1.5 1.5 0 0 1-1.5 1.5H7.5L4.5 14v-2.5H3A1.5 1.5 0 0 1 1.5 10V4A1.5 1.5 0 0 1 3 2.5Z',
    );
    bubble.setAttribute('fill', 'currentColor');
    icon.append(bubble);
    button.replaceChildren(icon);
  }

  private addToChat(range: SelectedLines): void {
    const { file } = this;
    if (file === undefined) {
      return;
    }
    const target = mentionFromTarget(
      targetFrom({ file, hunk: -1, selection: range, line: undefined, collapsed: false }),
    );
    if (target === undefined) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent('beuve-chat-add', { detail: { target }, bubbles: true, composed: true }),
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

  /** Delegates the crossing events while the chip or an insight note is there to act on them. */
  private syncCrossingDelegation(): void {
    const isNeeded = this.insights.length > 0 || this.impactParts() !== undefined;
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

  private noteElement(note: CardNote): HTMLElement {
    switch (note.kind) {
      case 'ura': {
        return uraMarkerElement(note.item);
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
  private insightOf(
    element: HTMLElement,
  ): { readonly note: HTMLElement; readonly insight: ReviewInsight } | undefined {
    const note = element.closest<HTMLElement>('[data-insight-key]');
    const key = note?.dataset['insightKey'];
    const insight = this.insights.find((candidate) => candidate.key === key);
    return note === null || insight === undefined ? undefined : { note, insight };
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

  /**
   * The ImpactGate indicator in the title bar (ADR 0042) and its popover, which opens on hover,
   * on keyboard focus and with ImpactGate Details, closes with Escape, and never traps focus.
   */
  private renderImpactChip(): TemplateResult | typeof nothing {
    const chip = planImpactChip(this.impact, this.findings, this.cognitiveLimit);
    if (chip === undefined) {
      return nothing;
    }
    const label = chip.tone === 'warning' ? `ImpactGate: ${chip.label}` : 'ImpactGate details';
    return html`<button
        type="button"
        class="impact-chip ${chip.tone}"
        aria-label=${label}
        aria-haspopup="dialog"
        aria-controls="impact-popover"
        data-action="impact-chip"
      >
        ${chip.tone === 'warning' ? warningIcon : gaugeIcon}${chip.label}
      </button>
      <div
        id="impact-popover"
        class="impact-popover"
        popover="manual"
        role="dialog"
        aria-label="ImpactGate"
        data-action="impact-popover"
      >
        ${this.renderImpactDetails(chip)}
      </div>`;
  }

  /** Escape on the chip or in its popover closes the popover. */
  private onImpactKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.hideImpact();
    this.dispatchEvent(new CustomEvent('beuve-impact-close', { bubbles: true, composed: true }));
  }

  /** Stages the chip's findings that are not in the review dock yet. */
  private stageImpactFindings(event: Event): void {
    event.stopPropagation();
    const chip = planImpactChip(this.impact, this.findings, this.cognitiveLimit);
    const unstaged = chip?.findings.filter((finding) => !this.isStaged(finding)) ?? [];
    for (const finding of unstaged) {
      this.dispatchEvent(
        new CustomEvent('beuve-ura-stage-finding', {
          detail: { path: finding.path, functionName: finding.functionName },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  private renderImpactDetails(chip: ImpactChip): TemplateResult {
    const unstaged = chip.findings.filter((finding) => !this.isStaged(finding));
    return html`<h3>ImpactGate</h3>
      <p>${chip.summary}</p>
      ${
        chip.rows.length === 0
          ? nothing
          : html`<table>
              <thead>
                <tr>
                  <th>Function</th>
                  <th>Lines</th>
                  <th title="Cognitive complexity, base → head">Cognitive</th>
                  <th title="Rank of the head value among the head's functions">Pctl</th>
                </tr>
              </thead>
              <tbody>
                ${chip.rows.map(
                  (row) =>
                    html`<tr class=${row.trend === undefined ? '' : 'breach'}>
                      <td class="fn" title=${row.name}>${row.name}</td>
                      <td>${row.lines}</td>
                      <td>
                        ${row.before === undefined ? 'new' : String(row.before)} →
                        ${row.after === undefined ? 'removed' : String(row.after)}${
                          row.trend === undefined ? '' : ` · ${row.trend}`
                        }
                      </td>
                      <td>${row.percentile === undefined ? '' : String(row.percentile)}</td>
                    </tr>`,
                )}
              </tbody>
            </table>`
      }
      ${chip.note === '' ? nothing : html`<p>${chip.note}</p>`}
      <div class="actions">
        ${
          chip.findings.length === 0
            ? nothing
            : html`<button
                type="button"
                ?disabled=${unstaged.length === 0}
                title=${
                  unstaged.length === 0
                    ? 'Staged in the review dock'
                    : `Stage ${unstaged.length === 1 ? 'this finding' : `these ${String(unstaged.length)} findings`} in the review dock`
                }
                data-action="impact-stage"
              >
                ${unstaged.length === 0 ? 'Staged' : 'Stage'}
              </button>`
        }
      </div>`;
  }

  private impactParts(): { chip: HTMLElement; popover: HTMLElement } | undefined {
    const chip = this.renderRoot.querySelector<HTMLElement>('.impact-chip');
    const popover = this.renderRoot.querySelector<HTMLElement>('.impact-popover');
    return chip === null || popover === null ? undefined : { chip, popover };
  }

  /** Opens the popover in the top layer, under the chip and inside the window. */
  private showImpact(): void {
    clearTimeout(this.impactHideTimer);
    const parts = this.impactParts();
    if (parts === undefined) {
      return;
    }
    const { chip, popover } = parts;
    if (!popover.matches(':popover-open')) {
      popover.showPopover();
    }
    const anchor = chip.getBoundingClientRect();
    const width = popover.getBoundingClientRect().width;
    const left = Math.max(8, Math.min(anchor.right - width, innerWidth - width - 8));
    const below = anchor.bottom + 4;
    const height = popover.getBoundingClientRect().height;
    const top = below + height > innerHeight - 8 ? Math.max(8, anchor.top - height - 4) : below;
    popover.style.left = `${String(Math.round(left))}px`;
    popover.style.top = `${String(Math.round(top))}px`;
    this.impactAnchorTop = anchor.top;
    addEventListener('scroll', this.onScrollWhileImpactOpen, { capture: true, passive: true });
  }

  private scheduleImpactHide(): void {
    clearTimeout(this.impactHideTimer);
    this.impactHideTimer = setTimeout(() => {
      const parts = this.impactParts();
      const isInside =
        parts !== undefined &&
        (parts.chip.matches(':hover, :focus') || parts.popover.matches(':hover, :focus-within'));
      if (!isInside) {
        this.hideImpact();
      }
    }, 150);
  }

  private hideImpact(): void {
    clearTimeout(this.impactHideTimer);
    removeEventListener('scroll', this.onScrollWhileImpactOpen, { capture: true });
    const popover = this.impactParts()?.popover;
    if (popover?.matches(':popover-open') === true) {
      popover.hidePopover();
    }
  }

  private isStaged(finding: ImpactFindingView): boolean {
    return this.uraItems.some(
      ({ origin, status, anchor }) =>
        origin.kind === 'impact-finding' &&
        status.kind !== 'withdrawn' &&
        origin.functionName === finding.functionName &&
        anchor.kind === 'lines' &&
        anchor.path === finding.path,
    );
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
    return this.mounted
      ? html`${keyed(this.codeGeneration, html`<div class="code"></div>`)}`
      : html`<div
          class="code placeholder"
          style=${styleMap({ height: `${String(this.measuredHeight ?? estimateHeight(file))}px` })}
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
    return this.reviewed === 'yes'
      ? html`<button
          type="button"
          class="reviewed-mark"
          title=${`Reviewed — click to unmark (${shortcutOf('toggle-reviewed', keyPlatformOf(navigator.platform))})`}
          aria-label="Reviewed; unmark"
          data-action="unmark"
        >
          ${checkIcon}
        </button>`
      : nothing;
  }

  /** Marked reviewed, but the file's diff is not the one that was reviewed any more. */
  private renderChangedSince(): TemplateResult | typeof nothing {
    return this.reviewed === 'changed-since'
      ? html`<span class="changed-since" title="Changed since you reviewed it"
          >changed since reviewed</span
        >`
      : nothing;
  }

  /** "2 insights" on a collapsed card: its findings are on lines the reviewer cannot see yet (ADR 0061). */
  private renderInsightBadge(): TemplateResult | typeof nothing {
    return this.collapsed && this.insights.length > 0
      ? html`<span
          class="tag insight-badge"
          title="/review findings on this file's lines; load the diff to read them"
          >${describeInsightCount(this.insights.length)}</span
        >`
      : nothing;
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
    const size =
      deferral === undefined
        ? ''
        : `${countFormat.format(deferral.rows)} lines · ${formatSize(deferral.characters)}`;
    return html`<div class="collapsed-body">
      <span class="why">${deferral?.why ?? 'Collapsed.'}</span>
      ${size === '' ? nothing : html`<span class="size">${size}</span>`}
      <button
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
    return html`${uraMarkersFrom(path, this.uraItems).map((marker) => uraMarkerElement(marker.item))}
      ${this.insights.map((insight) => this.insightNode(insight))}
      ${this.composer?.path === path ? this.composerNode() : nothing}
      <pre>
${splitPatch(file.patch).map(
          (line) =>
            html`<span class="line ${line.kind}">${line.text === '' ? ' ' : line.text}</span>`,
        )}</pre>`;
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
    const plan = buildSuggestedPatch(file?.path ?? '', editHead, editor.getText(), edit.target);
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
    const { startLine, endLine } = edit.target;
    const lines =
      startLine === endLine
        ? `line ${String(startLine)}`
        : `lines ${String(startLine)}–${String(endLine)}`;
    const what = `${edit.target.itemId === undefined ? 'Suggesting' : 'Editing the suggestion for'} ${lines}`;
    const state =
      edit.phase === 'loading'
        ? 'Opening the editor…'
        : edit.phase === 'failed'
          ? ''
          : 'Your files are never written';
    return html`<div class="edit-bar" role="status">
      <span class="what">${what}</span>
      <span>${state}</span>
      ${edit.error === '' ? nothing : html`<span class="error" role="alert">${edit.error}</span>`}
    </div>`;
  }

  /** Scrolls a row (or the card) into view vertically, keeping the code's horizontal scroll. */
  private scrollToRow(row: Element | undefined): void {
    const left = this.diff?.getCodeScrollLeft();
    (row ?? this).scrollIntoView({ block: row === undefined ? 'start' : 'center' });
    if (left !== undefined) {
      this.diff?.setCodeScrollLeft(left);
    }
  }

  override disconnectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.disconnectedCallback();
    this.hideImpact();
  }

  /** ImpactGate Details: focuses the ImpactGate indicator, which opens its popover; `false` without one. */
  focusImpact(): boolean {
    const chip = this.impactParts()?.chip;
    chip?.focus();
    return chip !== undefined;
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

  /**
   * Scrolls to lines `start`–`end` of one side and selects them, for a chat chip: head lines as
   * Open in Editor and citations find them, base lines by their own numbers on the deleted side.
   */
  async revealRange(start: number, end: number, side: 'head' | 'base'): Promise<void> {
    this.mounted = true;
    await this.updateComplete;
    const row = await waitFor(() =>
      side === 'base'
        ? this.findRow('deletions', start)
        : (this.findRow('additions', start) ?? this.findRow('context', start)),
    );
    const librarySide = side === 'base' ? 'deletions' : 'additions';
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
      const editor = new module.Editor<'file-diff', CardSlot>('file-diff');
      editor.edit(diff);
      const suggested =
        target.patch === undefined
          ? undefined
          : applySuggestedPatch(pair.newContents, target.patch);
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
      this.edit = {
        target,
        phase: 'failed',
        error: Error.isError(error) ? error.message : 'The editor could not start.',
      };
    }
  }

  /** Scrolls to head line `line` and makes it the card's target (a citation, flow or trace jump). */
  async focusLine(line: number): Promise<void> {
    await this.revealLine(line);
    // eslint-disable-next-line unicorn/no-null -- the library clears the selection with null.
    this.diff?.setSelectedLines(null);
    this.lineSelection = undefined;
    this.focusedLine = line;
  }

  /** Scrolls head line `line` into view (or the card's header without one), mounting the diff. */
  async revealLine(line: number | undefined): Promise<void> {
    this.mounted = true;
    await this.updateComplete;
    const row =
      line === undefined
        ? undefined
        : await waitFor(() => this.findRow('additions', line) ?? this.findRow('context', line));
    this.scrollToRow(row);
  }

  /** Selects hunk `index` and scrolls its first change into view, mounting the diff if needed. */
  async revealHunk(index: number): Promise<void> {
    this.mounted = true;
    this.activeHunk = index;
    await this.updateComplete;
    const step =
      this.metadata === undefined
        ? undefined
        : planHunkSteps(this.metadata.hunks, this.diffStyle)[index];
    const row =
      step === undefined ? undefined : await waitFor(() => this.findRow(step.side, step.start));
    this.scrollToRow(row);
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    this.syncEditKeys();
    if (changed.has('activeHunk')) {
      this.focusedLine = undefined;
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
      this.measuredHeight = height === undefined || height === 0 ? this.measuredHeight : height;
      this.unobserveCode();
      this.diff.cleanUp();
      this.diff = undefined;
    }
    if (changed.has('file')) {
      this.measuredHeight = undefined;
    }
    if (!changed.has('file') && !changed.has('library')) {
      return;
    }
    const { file, library } = this;
    this.metadata =
      file === undefined || library === undefined ? undefined : metadataFrom(library, file);
    this.isFallback = false;
  }

  protected override updated(changed: PropertyValues<this>): void {
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
      this.syncDiff(library, changed, container, metadata);
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
          <span class="status">${file.status}</span>
          <span class="path" title=${file.path}>
            ${
              file.oldPath === undefined
                ? nothing
                : html`<span class="old-path">${pathText(file.oldPath)} → </span>`
            }${pathText(file.path)}
          </span>
          ${this.renderChangedSince()} ${this.renderTag()} ${this.renderInsightBadge()}
          ${this.renderImpactChip()}
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
      ${
        this.trace === undefined
          ? nothing
          : html`<beuve-trace-portal
              .trace=${this.trace}
              @trace-line-activate=${this.onTraceLineActivate}
            ></beuve-trace-portal>`
      }
      ${this.renderCode(file)}
    `;
  }
}

/** A staged item's marker: its severity and title on one quiet line, built as text nodes. */
function uraMarkerElement(item: UraItemView): HTMLElement {
  const labels = describeUraItem(item);
  const marker = document.createElement('div');
  marker.className = `ura-marker ${item.severity}`;
  marker.dataset['uraItemId'] = item.id;
  marker.title = `Staged in the review dock: ${revealFormatControls(labels.anchor)}, from ${labels.origin}`;
  const kind = document.createElement('span');
  kind.className = 'ura-kind';
  kind.textContent = `Staged · ${labels.severity}${item.suggestedPatch === undefined ? '' : ' · suggestion'}`;
  const title = document.createElement('span');
  title.className = 'ura-title';
  title.append(...parseInlineTitle(item.title).map((span) => createInlineNode(span)));
  marker.append(kind, title);
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
  shared.pool = workers === undefined ? undefined : startWorkerPool(workers);
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
      workerFactory: (): Worker => new Worker(url, { type: 'module', name: 'beuve-highlighter' }),
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

const warningIcon: SVGTemplateResult = svg`<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5 11 10.5H1Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M6 5v2.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><circle cx="6" cy="9" r=".7" fill="currentColor"/></svg>`;

const gaugeIcon: SVGTemplateResult = svg`<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 8.5a4 4 0 0 1 8 0" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M6 8.5 7.8 5.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;

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
  return Object.hasOwn(highlightedLanguages, language)
    ? metadata
    : library.setLanguageOverride(metadata, 'text');
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
  return pair.oldContents === undefined
    ? // eslint-disable-next-line unicorn/no-null -- the library marks a pure rename's old side with null.
      { oldFile: null, newFile }
    : {
        oldFile: { name: fileDiff.prevName ?? fileDiff.name, contents: pair.oldContents },
        newFile,
      };
}

const estimatedHeights = new WeakMap<DiffFileView, number>();

/** About the rendered height of the patch: its lines, plus a separator per hunk; once per file. */
function estimateHeight(file: DiffFileView): number {
  const known = estimatedHeights.get(file);
  if (known !== undefined) {
    return known;
  }
  const lines = splitPatch(file.patch).filter(
    (line) => line.kind !== 'meta' && line.kind !== 'hunk',
  ).length;
  const height = lines * estimatedLineHeight + file.hunks.length * estimatedSeparatorHeight;
  estimatedHeights.set(file, height);
  return height;
}

const countFormat = new Intl.NumberFormat('en');

function formatSize(characters: number): string {
  return characters < 1024 * 1024
    ? `${String(Math.max(1, Math.round(characters / 1024)))} KB`
    : `${(characters / 1024 / 1024).toFixed(1)} MB`;
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
