import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import { repeat } from 'lit/directives/repeat.js';

import type {
  ReviewEditPreviewView,
  UraAnchorView,
  UraExportTarget,
  UraItemsChange,
  UraItemView,
  UraSeverityView,
  UraVerdictView,
} from '#contract/ipc-contract.ts';

import type { CommandId, KeyPlatform } from '#contract/command-catalog.ts';

import './beuve-note-expand.ts';
import './beuve-patch-preview.ts';
import './beuve-suggestion-field.ts';
import type { BeuveSuggestionField, SuggestionFieldKeyDetail } from './beuve-suggestion-field.ts';
import { suggestionFieldsFrom } from './suggestion-fields-from.ts';
import type { SuggestionFieldView, SuggestionLines } from './suggestion-field-view.ts';
import { withSuggestionField } from './with-suggestion-field.ts';
import { ActionDelegation } from './action-delegation.ts';
import { withPayload } from './with-payload.ts';
import { displayAccelerator } from './display-accelerator.ts';
import { keyPlatformOf } from './key-platform-of.ts';
import { describePostPreview } from './describe-post-preview.ts';
import { describeUraItem } from './describe-ura-item.ts';
import type { GithubNoteListState, GithubPostState } from './github-post-state.ts';
import type { ReviewEditsNoteListState, ReviewEditsFlow } from './review-edits-state.ts';
import { describeHarvest } from './describe-harvest.ts';
import { describeEditCounts } from './describe-edit-counts.ts';
import { dropUraItems } from './drop-ura-items.ts';
import { moveUraItems } from './move-ura-items.ts';
import { noteStatusChange } from './note-status-change.ts';
import { uraSeverityViews } from './ura-severity-views.ts';
import { noteListSelectionAfter } from './note-list-selection-after.ts';
import type { NoteListGesture, NoteListSelection } from './note-list-selection-after.ts';
import { countNoun } from './count-noun.ts';
import { parseInlineTitle } from './parse-inline-title.ts';
import { noteMarksFrom } from './note-marks-from.ts';
import { uraSeverityEmoji } from './ura-severity-emoji.ts';
import './primitives/beuve-agent-mark.ts';
import './beuve-ura-label-menu.ts';
import type { UraLabelChange } from './beuve-ura-label-menu.ts';
import type { InlineSpan } from './parse-markdown-subset.ts';
import { noteLabelStateFrom } from './note-label-state-from.ts';
import { resolveNoteListVerdict } from './resolve-note-list-verdict.ts';
import { zoneStyles } from './zone-styles.ts';
import { formatControlStyles } from './format-control-styles.ts';
import { pathText } from './path-text.ts';
import { describeSuggestionLines } from './describe-suggestion-lines.ts';
import { buttonStyles } from './primitives/button-styles.ts';
import { fieldStyles } from './primitives/field-styles.ts';
import { completionListStyles } from './completion-list-styles.ts';
import { EmojiCompletion } from './emoji-completion.ts';
import { emojiCompletionStyles } from './emoji-completion-styles.ts';
import { suggestionPreviewFrom } from './suggestion-preview-from.ts';

/** A status line under the export buttons; `tone` colors it. */
export interface NoteListNotice {
  readonly tone: 'info' | 'error';
  readonly text: string;
}

const verdictLabels: Readonly<Record<UraVerdictView, string>> = {
  approve: 'Approve',
  comment: 'Comment',
  'request-changes': 'Request changes',
};

/** The exports the notes list offers as buttons; File › Export Review has all of them. */
type NoteListExportTarget = Extract<UraExportTarget, 'agent-xml' | 'agent-json' | 'github'>;

interface NoteListExport {
  readonly label: string;
  readonly title: string;
}

const noteListExportTargets: readonly NoteListExportTarget[] = [
  'agent-xml',
  'agent-json',
  'github',
];

const noteListExports: Readonly<Record<NoteListExportTarget, NoteListExport>> = {
  'agent-xml': {
    label: 'Copy as XML',
    title: 'Copy the review as XML for Claude Code (beuve.ura/2), summary included',
  },
  'agent-json': {
    label: 'Copy as JSON',
    title: 'Copy the same review as JSON for agents (beuve.ura/2), summary included',
  },
  github: {
    label: 'Copy GitHub review (JSON)',
    title: 'The body of POST /repos/{owner}/{repo}/pulls/{number}/reviews, summary included',
  },
};

/**
 * Zone 3: the Universal Review Artifact notes list (ADR 0023, 0027). Lists the session's open
 * notes in export order, then the closed ones under their own heading; each row is the label's
 * emoji, what the note says, its path, and only what is marked (ADR 0154). While the zone has focus: ↑/↓ move,
 * Return jumps the diff stream to the item, Space opens its editor (label, Blocking, title, body),
 * Delete withdraws or restores it, Shift+Delete deletes it and ⌥↑/⌥↓ move it up or down the
 * export order, as dragging a staged note among the staged ones does (ADR 0144); a double-click
 * edits it too (ADR 0129). ⇧↑/⇧↓, Shift+click and ⌘/Ctrl+click select several notes, ⌘A / Ctrl+A
 * selects them all and Escape clears the selection; the Note commands but Show and Edit then act
 * on every selected note, and a bar above the list shows the count and relabels them (ADR 0144).
 * The Note menu and the context menu run the same commands (`runCommand`, ADR 0068), and Open in
 * Editor opens it (`beuve-open-editor`). A verdict selector shows the derived default and refuses
 * approving over a staged blocking note; export buttons copy the compiled review. Items carrying
 * a suggestion preview it under the cursor; the editor shows each suggestion as a field with
 * Remove, and Add suggestion adds one over the note's lines, or for a note without lines the
 * diff's selection (`beuve-suggestion-target`, ADR 0162). Saving sends every field back with its
 * id. Presentational: emits `beuve-ura-jump`, `beuve-ura-update`, `beuve-ura-edit-many`,
 * `beuve-ura-delete`, `beuve-ura-reorder` and `beuve-ura-export`; `beuve-app` does the IPC.
 */
@customElement('beuve-note-list')
export class BeuveNoteList extends LitElement {
  static override styles = [
    buttonStyles,
    fieldStyles,
    formatControlStyles,
    zoneStyles,
    completionListStyles,
    emojiCompletionStyles,
    css`
      :host {
        border-inline-start: var(--beuve-border-width) solid var(--beuve-border);
      }

      /* Pinned under the notes, so the verdict, summary and Post stay in one place as notes come and go. */
      .export {
        flex: none;
        max-block-size: 60%;
        overflow: auto;
        padding: var(--beuve-space-3);
        border-block-start: var(--beuve-border-width) solid var(--beuve-border);
      }

      .count {
        margin-inline-start: auto;
        font-weight: var(--beuve-font-weight-normal);
        letter-spacing: 0;
        text-transform: none;
      }

      ol {
        display: flex;
        flex-direction: column;
        gap: var(--beuve-space-0-5);
        margin: 0;
        padding: 0;
        list-style: none;
      }

      li {
        position: relative;
        display: grid;
        grid-template-columns: calc(1.5 * var(--beuve-measure-em)) minmax(0, 1fr);
        column-gap: var(--beuve-space-1-5);
        padding: var(--beuve-space-1) var(--beuve-space-2);
        border: var(--beuve-border-width) solid transparent;
        border-radius: var(--beuve-radius);
        cursor: pointer;
      }

      li:hover {
        background: var(--beuve-surface-sunken);
      }

      li.cursor {
        border-color: var(--beuve-border);
        background: var(--beuve-surface-sunken);
      }

      :host([focused]) li.cursor {
        border-color: var(--beuve-accent);
      }

      li.selected {
        background: var(--beuve-accent-soft);
      }

      .selection {
        display: flex;
        align-items: center;
        gap: var(--beuve-space-2);
        margin-block-end: var(--beuve-space-1);
        font: var(--beuve-font-small);
      }

      .selection-count {
        color: var(--beuve-text-muted);
      }

      li.dragging {
        opacity: 0.5;
      }

      /* ADR 0144: where dropped notes land, a bar in the gap before or after a staged note. */
      li.drop-before::before,
      li.drop-after::after {
        content: '';
        position: absolute;
        inset-inline: 0;
        block-size: var(--beuve-border-width-thick);
        border-radius: var(--beuve-radius-small);
        background: var(--beuve-accent);
        pointer-events: none;
      }

      li.drop-before::before {
        inset-block-start: calc(
          -0.5 *
            (var(--beuve-space-0-5) + var(--beuve-border-width-thick)) - var(--beuve-border-width)
        );
      }

      li.drop-after::after {
        inset-block-end: calc(
          -0.5 *
            (var(--beuve-space-0-5) + var(--beuve-border-width-thick)) - var(--beuve-border-width)
        );
      }

      .meta {
        display: flex;
        align-items: center;
        gap: var(--beuve-space-2);
        min-inline-size: 0;
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      .anchor {
        flex: 1;
        min-inline-size: 0;
        overflow: hidden;
        font: var(--beuve-font-code);
        font-size: var(--beuve-font-size-caption);
        text-overflow: ellipsis;
        white-space: nowrap;
        direction: rtl;
        text-align: start;
      }

      .severity {
        flex: none;
        padding: 0 var(--beuve-space-1);
        border: var(--beuve-border-width) solid currentcolor;
        border-radius: var(--beuve-radius-small);
      }

      .severity.issue,
      .severity.todo,
      .severity.chore {
        color: var(--beuve-warn);
      }

      .severity.suggestion,
      .severity.question {
        color: var(--beuve-accent);
      }

      .severity.nitpick,
      .severity.thought,
      .severity.smell,
      .severity.note {
        color: var(--beuve-text-muted);
      }

      .severity.praise {
        color: var(--beuve-ok);
      }

      .severity.blocking {
        color: var(--beuve-danger);
      }

      .origin {
        flex: none;
      }

      .outdated {
        flex: none;
        color: var(--beuve-warn);
      }

      .title {
        margin-block-start: var(--beuve-space-px);
        overflow-wrap: anywhere;
      }

      .title code {
        padding: 0 var(--beuve-space-0-5);
        border-radius: var(--beuve-radius-small);
        background: var(--beuve-surface-sunken);
        font: var(--beuve-font-code);
      }

      /* ADR 0154: the label's emoji in its own column, then text, path and marks. */
      .note-kind {
        text-align: center;
        font-size: var(--beuve-font-size-body);
        line-height: var(--beuve-line-height-normal);
      }

      .note-content {
        display: flex;
        flex-direction: column;
        gap: var(--beuve-space-px);
        min-inline-size: 0;
      }

      .note-title {
        font-weight: var(--beuve-font-weight-medium);
        overflow-wrap: anywhere;
      }

      .note-text {
        display: -webkit-box;
        overflow: hidden;
        overflow-wrap: anywhere;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }

      :is(.note-title, .note-text) code {
        padding: 0 var(--beuve-space-0-5);
        border-radius: var(--beuve-radius-small);
        background: var(--beuve-surface-sunken);
        font: var(--beuve-font-code);
      }

      .note-path {
        overflow: hidden;
        color: var(--beuve-text-muted);
        font: var(--beuve-font-code);
        font-size: var(--beuve-font-size-caption);
        text-overflow: ellipsis;
        white-space: nowrap;
        direction: rtl;
        /* The box is right to left, so a long path loses its start; its end is the left edge. */
        text-align: end;
      }

      .note-path.whole {
        font: var(--beuve-font-small);
        direction: ltr;
        text-align: start;
      }

      .note-marks {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        column-gap: var(--beuve-space-1);
        color: var(--beuve-text-muted);
        font: var(--beuve-font-small);
        font-weight: var(--beuve-font-weight-semibold);
      }

      .mark + .mark::before {
        content: '•';
        margin-inline-end: var(--beuve-space-1);
        color: var(--beuve-text-faint);
        font-weight: var(--beuve-font-weight-normal);
      }

      .mark-blocking {
        color: var(--beuve-danger);
      }

      .mark-outdated {
        color: var(--beuve-warn);
      }

      .mark-addressed {
        color: var(--beuve-ok);
      }

      li.closed :is(.note-title, .note-text) {
        color: var(--beuve-text-muted);
        font-weight: var(--beuve-font-weight-normal);
      }

      .list-heading {
        margin: var(--beuve-space-3) var(--beuve-space-2) var(--beuve-space-1);
        font: var(--beuve-font-small);
      }

      .list-heading > button {
        display: flex;
        align-items: baseline;
        gap: var(--beuve-space-1);
        inline-size: 100%;
        padding: 0;
        border: none;
        background: none;
        color: var(--beuve-text-muted);
        font: inherit;
        font-weight: var(--beuve-font-weight-semibold);
        text-align: start;
        cursor: pointer;
      }

      .list-heading > button:hover {
        color: var(--beuve-text);
      }

      .list-chevron::before {
        content: '▾';
      }

      .list-heading > button[aria-expanded='false'] .list-chevron::before {
        content: '▸';
      }

      .list-heading .list-count {
        margin-inline-start: auto;
      }

      .list-count {
        font-weight: var(--beuve-font-weight-normal);
      }

      li > .editor {
        grid-column: 1 / -1;
      }

      beuve-patch-preview {
        margin-block-start: var(--beuve-space-1);
      }

      .editor .suggestions {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--beuve-space-2);
      }

      .editor .suggestion-notice {
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      .editor {
        box-sizing: border-box;
        max-inline-size: var(--beuve-size-note-measure);
        display: grid;
        gap: var(--beuve-space-1);
        margin-block-start: var(--beuve-space-1);
        cursor: default;
      }

      textarea {
        box-sizing: border-box;
        min-inline-size: 0;
        padding: var(--beuve-space-1) var(--beuve-space-2);
        border: var(--beuve-border-width) solid var(--beuve-border);
        border-radius: var(--beuve-radius-small);
        background: var(--beuve-bg);
        color: var(--beuve-text);
        font: inherit;
      }

      textarea {
        field-sizing: content;
        inline-size: 100%;
        min-block-size: var(--beuve-size-note-editor-min);
        max-block-size: var(--beuve-size-note-editor-max);
        resize: block;
        font: var(--beuve-font-code);
      }

      textarea:focus {
        border-color: var(--beuve-accent);
        outline: none;
      }

      .row {
        display: flex;
        align-items: center;
        gap: var(--beuve-space-2);
      }

      .row > .field {
        flex: 1;
      }

      .spacer {
        flex: 1;
      }

      .exports {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: var(--beuve-space-1);
        margin-block-start: var(--beuve-space-2);
      }

      .github {
        display: grid;
        gap: var(--beuve-space-1);
        margin-block-start: var(--beuve-space-2);
      }

      .github .note {
        margin: 0;
      }

      .github.confirm {
        padding: var(--beuve-space-2);
        border: var(--beuve-border-width) solid var(--beuve-accent);
        border-radius: var(--beuve-radius);
        background: var(--beuve-accent-soft);
      }

      .github .actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: var(--beuve-space-1);
      }

      .review-edits {
        display: grid;
        gap: var(--beuve-space-1);
        margin-block-start: var(--beuve-space-2);
        padding-block-start: var(--beuve-space-2);
        border-block-start: var(--beuve-border-width) solid var(--beuve-border);
      }

      .review-edits .note {
        margin: 0;
        overflow-wrap: anywhere;
      }

      .review-edits > .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--beuve-space-1);
      }

      .review-edits code {
        font: var(--beuve-font-code);
        font-size: var(--beuve-font-size-caption);
      }

      .harvest {
        display: grid;
        gap: var(--beuve-space-1);
        max-block-size: var(--beuve-size-window-block-40);
        margin: 0;
        padding: 0;
        overflow: auto;
        list-style: none;
        font: var(--beuve-font-small);
      }

      .harvest li {
        cursor: default;
      }

      .harvest-suggestions {
        display: grid;
        gap: var(--beuve-space-1);
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .posted {
        font: var(--beuve-font-small);
        color: var(--beuve-ok);
      }

      .verdict {
        display: flex;
        align-items: center;
        gap: var(--beuve-space-2);
        font: var(--beuve-font-small);
      }

      .verdict select {
        flex: 1;
      }

      .note {
        margin: var(--beuve-space-2) 0 0;
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      .note.error {
        color: var(--beuve-danger);
      }
    `,
  ];

  /** The note the cursor moves to once the items arrive in their new order, after a drop. */
  private cursorFollows: string | undefined;

  private readonly onLabelChange = (event: CustomEvent<UraLabelChange>): void => {
    if (isInSelectionBar(event)) {
      this.changeSelectedLabel(event.detail);
      return;
    }
    this.editingSeverity = event.detail.severity;
    this.editingBlocking = event.detail.blocking;
  };

  /** A field's Remove: the editor loses that field. */
  private readonly onFieldRemove = (event: CustomEvent<SuggestionFieldKeyDetail>): void => {
    event.stopPropagation();
    const { key } = event.detail;
    this.editingSuggestions = this.editingSuggestions.filter((field) => field.key !== key);
  };

  /** ⌘/Ctrl+Return in a field saves the editor's note, as it does in the title and body. */
  private readonly onFieldSave = (event: Event): void => {
    event.stopPropagation();
    this.renderRoot.querySelector<HTMLFormElement>('form.editor')?.requestSubmit();
  };

  private readonly onFieldCancel = (event: Event): void => {
    event.stopPropagation();
    this.closeEditor();
  };

  /** Numbers new suggestion fields, for their keys. */
  private fieldCount = 0;

  /** `:shortcode:` emoji in the editor's title and body and the review summary (ADR 0145). */
  private readonly emoji = new EmojiCompletion(this);

  /**
   * The notes list's in-place keys (ADR 0068, 0144): ↑/↓ move, ⇧↑/⇧↓ extend the selection, ⌘A / Ctrl+A
   * selects every note and Escape clears the selection, Return shows, Space edits, Delete
   * withdraws, ⌥↑/⌥↓ reorder.
   */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) {
      return;
    }
    if (isInSelectionBar(event)) {
      this.selectionBarKey(event);
      return;
    }
    const isEditing = isTextEntry(event) || isInEditor(event);
    if (!isEditing && this.isSelectAll(event)) {
      event.preventDefault();
      this.runCommand('note-select-all');
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      return;
    }
    if (isEditing) {
      this.editorKey(event);
      return;
    }
    const step = ({ ArrowDown: 1, ArrowUp: -1 } as const)[event.key];
    if (step !== undefined && !event.altKey) {
      event.preventDefault();
      this.moveCursor(step, event.shiftKey);
      return;
    }
    if (event.key === 'Escape' && this.selection.selected.length > 0) {
      event.preventDefault();
      this.selection = { selected: [], anchor: undefined };
      return;
    }
    let key = event.key;
    if (event.altKey) {
      key = `Alt+${event.key}`;
    } else if (event.shiftKey) {
      key = `Shift+${event.key}`;
    }
    const id = inPlaceKeys[key];
    if (id === undefined) {
      return;
    }

    event.preventDefault();
    this.runCommand(id);
  };

  @property({ type: Boolean, reflect: true }) accessor focused = false;
  /** Whether a review session is open; without one there is nothing to stage into. */
  @property({ type: Boolean }) accessor hasSession = false;
  /** The open session's items in note order, every status (`ura:list`). */
  @property({ attribute: false }) accessor items: readonly UraItemView[] = [];
  /** Whether closed notes, addressed or withdrawn, are listed (preference `showClosedNotes`, ADR 0149). */
  @property({ type: Boolean }) accessor showClosed = true;
  @property() accessor derivedVerdict: UraVerdictView = 'approve';
  /** The verdict stored for the session (`ura:list`); absent when the derived one applies. */
  @property() accessor chosenVerdict: UraVerdictView | undefined;
  /** Why a stored verdict was dropped, shown until the reviewer chooses again. */
  @property() accessor verdictNotice = '';
  @property({ attribute: false }) accessor notice: NoteListNotice | undefined;
  /** Set by the owner while an export is being compiled and copied. */
  @property({ type: Boolean }) accessor exporting = false;
  /** Set for pull request sessions: posting to GitHub replaces copying the review JSON. */
  @property({ attribute: false }) accessor github: GithubNoteListState | undefined;

  @state() accessor cursor = 0;
  /** The notes picked besides the cursor (ADR 0144); empty is the cursor's note alone. */
  @state() accessor selection: NoteListSelection = { selected: [], anchor: undefined };
  /** Where a note being dragged would land (ADR 0144); absent while nothing is dragged over one. */
  @state() accessor dropTarget: DropTarget | undefined;
  /** The notes being dragged, while a drag from the list runs. */
  @state() accessor draggedIds: readonly string[] = [];
  @state() accessor editingId: string | undefined;
  /** The open editor's label and Blocking, which start from the note's own (ADR 0131). */
  @state() accessor editingSeverity: UraSeverityView = 'issue';
  @state() accessor editingBlocking = false;
  /** The open editor's suggestion fields, which start from the note's own (ADR 0162). */
  @state() accessor editingSuggestions: readonly SuggestionFieldView[] = [];
  /** Why Add suggestion added no field, until the editor changes. */
  @state() accessor suggestionNotice = '';
  @state() accessor verdictRefusal = '';
  /** The review summary being written; kept until it is posted or another pull request opens. */
  @state() accessor summary = '';

  /** `process.platform`, for the Save button's tooltip. */
  @property() accessor platform = '';

  /** The session's review edits (ADR 0088); shown only once they exist or an action runs. */
  @property({ attribute: false }) accessor reviewEdits: ReviewEditsNoteListState | undefined;

  constructor() {
    super();
    this.addEventListener('keydown', this.onKeyDown);
    this.addEventListener('beuve-ura-label-change', this.onLabelChange as EventListener);
    this.addEventListener('beuve-suggestion-field-remove', this.onFieldRemove as EventListener);
    this.addEventListener('beuve-suggestion-field-save', this.onFieldSave);
    this.addEventListener('beuve-suggestion-field-cancel', this.onFieldCancel);
    // ADR 0074: the items, their editor and the export buttons, through one listener per type.
    this.addController(
      new ActionDelegation(this, {
        click: {
          'toggle-closed': (_data, event): void => {
            event.stopPropagation();
            this.emit('beuve-ura-toggle-closed', undefined);
          },
          'review-edits': ({ op = '' }, event): void => {
            event.stopPropagation();
            this.emit('beuve-review-edits', { op });
          },
          item: withPayload(
            ({ itemId }) => {
              return this.itemOf(itemId);
            },
            (found, event): void => {
              this.clickItem(found, event);
            },
          ),
          editor: (_data, event): void => {
            event.stopPropagation();
          },
          'clear-selection': (_data, event): void => {
            event.stopPropagation();
            this.selection = { selected: [], anchor: undefined };
          },
          'cancel-edit': (_data, event): void => {
            event.stopPropagation();
            this.closeEditor();
          },
          'add-suggestion': withPayload(
            ({ itemId }) => {
              return this.itemOf(itemId);
            },
            (found, event): void => {
              event.stopPropagation();
              this.addSuggestion(found);
            },
          ),
          export: withPayload(
            ({ target }) => {
              return noteListExportTargets.find((candidate) => candidate === target);
            },
            (target): void => {
              this.exportTo(target);
            },
          ),
        },
        // A Shift+click extends the selection instead of selecting text (ADR 0144).
        mousedown: {
          item: (_data, event): void => {
            if (event.shiftKey) {
              event.preventDefault();
            }
          },
        },
        // ADR 0144: staged notes drag to a new place among the staged ones.
        dragstart: {
          item: withPayload(
            ({ itemId }) => {
              return this.itemOf(itemId);
            },
            (found, event): void => {
              this.startDrag(found, event);
            },
          ),
        },
        dragover: {
          item: withPayload(
            ({ itemId }) => {
              return this.itemOf(itemId);
            },
            (found, event, element): void => {
              this.dragOver(found, { event, element });
            },
          ),
        },
        drop: {
          item: (_data, event): void => {
            event.preventDefault();
            this.dropDragged();
          },
        },
        dragend: {
          item: (): void => {
            this.endDrag();
          },
        },
        dragleave: {
          list: (_data, event, element): void => {
            if (!(event.relatedTarget instanceof Node) || !element.contains(event.relatedTarget)) {
              this.dropTarget = undefined;
            }
          },
        },
        // ADR 0129: a double-click edits the note; one in its open editor stays there.
        dblclick: {
          editor: (_data, event): void => {
            event.stopPropagation();
          },
          item: withPayload(
            ({ itemId }) => {
              return this.itemOf(itemId);
            },
            (found): void => {
              this.cursor = this.ordered().indexOf(found);
              this.openEditor(found);
            },
          ),
        },
        submit: {
          editor: withPayload(
            ({ itemId }) => {
              return this.itemOf(itemId);
            },
            (found, event, form): void => {
              event.preventDefault();
              this.saveEditor(found, form as HTMLFormElement);
            },
          ),
        },
        keydown: {
          editor: (_data, event, form): void => {
            submitOnModEnter(event, form as HTMLFormElement);
          },
        },
      }),
    );
  }

  private itemOf(itemId: string | undefined): UraItemView | undefined {
    return this.items.find((item) => item.id === itemId);
  }

  /** Moves the cursor a note; with Shift the selection grows or shrinks with it (ADR 0144). */
  private moveCursor(step: 1 | -1, isExtending: boolean): void {
    const order = this.ordered().map((item) => item.id);
    const from = order[this.cursor];
    this.cursor = Math.min(Math.max(0, this.cursor + step), Math.max(0, order.length - 1));
    const to = order[this.cursor];
    this.editingId = undefined;
    if (isExtending && from !== undefined && to !== undefined) {
      this.select({ kind: 'extend', from, to });
    } else {
      this.select({ kind: 'move' });
    }
    void this.revealCursor();
  }

  /** A click puts the cursor on the note; Shift extends the selection and ⌘/Ctrl toggles it. */
  private clickItem(item: UraItemView, event: MouseEvent): void {
    const order = this.ordered().map((entry) => entry.id);
    const from = order[this.cursor] ?? item.id;
    this.cursor = order.indexOf(item.id);
    if (event.shiftKey) {
      this.select({ kind: 'extend', from, to: item.id });
    } else if (this.isToggleClick(event)) {
      this.select({ kind: 'toggle', from, to: item.id });
    } else {
      this.select({ kind: 'move' });
    }
  }

  private select(gesture: NoteListGesture): void {
    this.selection = noteListSelectionAfter(this.selection, {
      gesture,
      order: this.ordered().map((item) => item.id),
    });
  }

  /** ⌘-click on macOS, Ctrl+click elsewhere (on macOS Ctrl+click opens the context menu). */
  private isToggleClick(event: MouseEvent): boolean {
    if (keyPlatformOf(this.platform) === 'mac') {
      return event.metaKey;
    }
    return event.ctrlKey;
  }

  /** ⌘A on macOS, Ctrl+A elsewhere: the notes list's Select All Notes while the list has the focus. */
  private isSelectAll(event: KeyboardEvent): boolean {
    const isMac = keyPlatformOf(this.platform) === 'mac';
    let hasModifier = event.ctrlKey && !event.metaKey;
    if (isMac) {
      hasModifier = event.metaKey && !event.ctrlKey;
    }
    return hasModifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'a';
  }

  /** The selection bar's label menu: a label choice relabels every note, Blocking flips them all. */
  private changeSelectedLabel(change: UraLabelChange): void {
    const targets = this.targetItems();
    const itemIds = targets.map((item) => item.id);
    if (itemIds.length === 0) {
      return;
    }
    if (change.changed === 'blocking') {
      this.emit('beuve-ura-edit-many', {
        itemIds,
        change: { kind: 'blocking', blocking: change.blocking },
      });
      return;
    }
    this.emit('beuve-ura-edit-many', {
      itemIds,
      change: { kind: 'severity', severity: change.severity },
    });
  }

  /**
   * The listed items: staged ones first, in export order, then the closed ones (withdrawn and
   * addressed), unless closed notes are hidden (ADR 0149).
   */
  private ordered(): UraItemView[] {
    const staged = this.items.filter((item) => item.status.kind === 'staged');
    if (!this.showClosed) {
      return staged;
    }
    return [...staged, ...this.items.filter((item) => item.status.kind !== 'staged')];
  }

  /** Open in Editor: the item's file at its current first line (line 1 for file notes and outdated items). */
  private openInEditor(item: UraItemView): void {
    const { placement } = item;
    if (placement.kind !== 'current') {
      if (item.anchor.kind !== 'change') {
        this.emit('beuve-open-editor', { path: item.anchor.path, line: 1 });
      }
      return;
    }
    const target = placement.anchor;
    if (target.kind === 'change') {
      return;
    }
    let line = 1;
    if (target.kind === 'lines') {
      line = target.startLine;
    }
    this.emit('beuve-open-editor', { path: target.path, line });
  }

  private emit(name: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  /** Moves the notes a step among the staged ones; the cursor stays on its note. */
  private move(items: readonly UraItemView[], step: 1 | -1): void {
    const order = this.items.map((entry) => entry.id);
    const moved = moveUraItems(order, {
      ids: items.map((item) => item.id),
      step,
      movable: this.stagedIds(),
    });
    if (moved.every((id, index) => id === order[index])) {
      return;
    }
    this.cursorFollows = this.cursorItem()?.id;
    this.emit('beuve-ura-reorder', { itemIds: moved });
  }

  /** Starts dragging `item`, which only a staged note can be. */
  private startDrag(item: UraItemView, event: DragEvent): void {
    if (item.status.kind !== 'staged' || event.dataTransfer === null) {
      event.preventDefault();
      return;
    }
    const selected = this.targetItems().filter((entry) => entry.status.kind === 'staged');
    this.draggedIds = [item.id];
    if (selected.some((entry) => entry.id === item.id)) {
      this.draggedIds = selected.map((entry) => entry.id);
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(dragType, this.draggedIds.join(' '));
  }

  /** Over a staged note, the bar shows on the nearer side of it; elsewhere there is no drop. */
  private dragOver(item: UraItemView, { event, element }: DragOverPlace): void {
    if (this.draggedIds.length === 0 || item.status.kind !== 'staged') {
      this.dropTarget = undefined;
      return;
    }
    event.preventDefault();
    if (event.dataTransfer !== null) {
      event.dataTransfer.dropEffect = 'move';
    }
    const box = element.getBoundingClientRect();
    let side: DropTarget['side'] = 'after';
    if (event.clientY < box.top + box.height / 2) {
      side = 'before';
    }
    if (this.draggedIds.includes(item.id)) {
      this.dropTarget = undefined;
      return;
    }
    if (this.dropTarget?.id !== item.id || this.dropTarget.side !== side) {
      this.dropTarget = { id: item.id, side };
    }
  }

  /** Moves the dragged notes to the drop target, through the same reorder Move Up and Down use. */
  private dropDragged(): void {
    const target = this.dropTarget;
    const ids = this.draggedIds;
    this.endDrag();
    if (target === undefined || ids.length === 0) {
      return;
    }
    const order = this.items.map((entry) => entry.id);
    const dropped = dropUraItems(order, {
      ids,
      targetId: target.id,
      side: target.side,
      movable: this.stagedIds(),
    });
    if (dropped.every((id, index) => id === order[index])) {
      return;
    }
    this.cursorFollows = ids[0];
    this.emit('beuve-ura-reorder', { itemIds: dropped });
  }

  private endDrag(): void {
    this.draggedIds = [];
    this.dropTarget = undefined;
  }

  private stagedIds(): ReadonlySet<string> {
    return new Set(
      this.items.filter((entry) => entry.status.kind === 'staged').map((entry) => entry.id),
    );
  }

  private toggleEditor(item: UraItemView): void {
    if (this.editingId === item.id) {
      this.editingId = undefined;
      return;
    }
    this.openEditor(item);
  }

  private openEditor(item: UraItemView, focus: 'title' | 'label' = 'title'): void {
    this.editingId = item.id;
    this.editingSeverity = item.severity;
    this.editingBlocking = item.blocking;
    this.editingSuggestions = suggestionFieldsFrom(item);
    this.suggestionNotice = '';
    void this.focusEditor(focus);
  }

  /** Withdraw or Mark Addressed, or back to staged when every note is that already (ADR 0144). */
  private toggleStatus(items: readonly UraItemView[], status: 'withdrawn' | 'addressed'): void {
    const change = noteStatusChange(items, status);
    if (change !== undefined) {
      this.emit('beuve-ura-edit-many', change);
    }
  }

  /** The context menu's Status (ADR 0150, 0151): every note not already there takes `status`. */
  private setStatus(items: readonly UraItemView[], status: UraStatusKind): void {
    const moving = items.filter((item) => item.status.kind !== status);
    this.emitChange(moving, { kind: statusActions[status] });
  }

  /** Sends one change for these notes, unless there are none. */
  private emitChange(items: readonly UraItemView[], change: UraItemsChange): void {
    if (items.length === 0) {
      return;
    }
    this.emit('beuve-ura-edit-many', { itemIds: items.map((item) => item.id), change });
  }

  /** Mark as Blocking, or Not Blocking when every note blocks already. */
  private toggleBlocking(items: readonly UraItemView[]): void {
    if (items.length === 0) {
      return;
    }
    this.emit('beuve-ura-edit-many', {
      itemIds: items.map((item) => item.id),
      change: { kind: 'blocking', blocking: items.some((item) => !item.blocking) },
    });
  }

  /**
   * Change Label…: the selection bar's label menu takes the keyboard; with no selection, the
   * cursor's note opens in its editor with the keyboard on its label.
   */
  private changeLabel(current: UraItemView | undefined): void {
    if (this.selection.selected.length > 0) {
      void this.updateComplete.then(() => {
        this.renderRoot.querySelector<HTMLElement>('.selection beuve-ura-label-menu')?.focus();
      });
      return;
    }
    if (current === undefined) {
      return;
    }
    this.openEditor(current, 'label');
  }

  private async focusEditor(focus: 'title' | 'label'): Promise<void> {
    await this.updateComplete;
    if (focus === 'label') {
      this.renderRoot.querySelector<HTMLElement>('.editor beuve-ura-label-menu')?.focus();
      return;
    }
    this.renderRoot.querySelector<HTMLInputElement>('.editor input')?.focus();
  }

  /** Escape in the selection bar clears the selection and gives the keyboard back to the list. */
  private selectionBarKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key !== 'Escape') {
      return;
    }
    event.preventDefault();
    this.selection = { selected: [], anchor: undefined };
    this.focus();
  }

  /** In the editor, ⌘/Ctrl+Enter is handled by the form; Escape closes it, keeping the cursor. */
  private editorKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key !== 'Escape') {
      return;
    }
    event.preventDefault();
    this.closeEditor();
  }

  private closeEditor(): void {
    this.editingId = undefined;
    this.focus();
  }

  private saveEditor(item: UraItemView, form: HTMLFormElement): void {
    const data = new FormData(form);
    const field = (name: string): string => {
      const value = data.get(name);
      if (typeof value === 'string') {
        return value;
      }
      return '';
    };
    const title = field('title').trim();
    const fields = [...form.querySelectorAll<BeuveSuggestionField>('beuve-suggestion-field')];
    const suggestions = fields.map((element) => element.draft());
    const reading = fields.find((_element, index) => suggestions[index] === undefined);
    if (reading !== undefined) {
      reading.focus();
      return;
    }
    if (title === '' && field('body').trim() === '' && fields.length === 0) {
      form.querySelector('input')?.focus();
      return;
    }
    this.emit('beuve-ura-update', {
      itemId: item.id,
      title,
      body: field('body'),
      severity: this.editingSeverity,
      blocking: this.editingBlocking,
      suggestions: suggestions.filter((suggestion) => suggestion !== undefined),
    });
    this.closeEditor();
  }

  /**
   * Add suggestion: a field over the note's own lines at the head it was written against, or, for
   * a note without lines, over the lines selected in the diff when they are on that head.
   */
  private addSuggestion(item: UraItemView): void {
    this.suggestionNotice = '';
    if (item.anchor.kind === 'lines') {
      const { path, startLine, endLine } = item.anchor;
      this.addField({ path, startLine, endLine }, item.headSha);
      return;
    }
    const answer = this.askSuggestionTarget();
    if (answer.kind === 'refused') {
      this.suggestionNotice = answer.reason;
      return;
    }
    if (answer.headSha !== item.headSha) {
      this.suggestionNotice =
        'This note was written on an older head, so its suggestions are on that head’s lines.';
      return;
    }
    this.addField(answer.lines, item.headSha);
  }

  /** The diff's selected lines, as the review answers `beuve-suggestion-target`. */
  private askSuggestionTarget(): SuggestionTargetAnswer {
    const answers: SuggestionTargetAnswer[] = [];
    const detail: SuggestionTargetRequestDetail = {
      respond: (answer): void => {
        answers.push(answer);
      },
    };
    this.dispatchEvent(
      new CustomEvent('beuve-suggestion-target', { detail, bubbles: true, composed: true }),
    );
    return (
      answers[0] ?? { kind: 'refused', reason: 'Select lines in the diff to suggest a change on.' }
    );
  }

  /** Adds a field and focuses it, or focuses the field already on some of its lines. */
  private addField(lines: SuggestionLines, headSha: string): void {
    this.fieldCount += 1;
    const field: SuggestionFieldView = { key: `new-${String(this.fieldCount)}`, headSha, ...lines };
    const change = withSuggestionField(this.editingSuggestions, field);
    let key = field.key;
    if (change.kind === 'overlaps') {
      this.suggestionNotice = 'Some of these lines already have a suggestion in this note.';
      key = change.field.key;
    } else {
      this.editingSuggestions = change.fields;
    }
    void this.updateComplete.then(() => {
      const element = [
        ...this.renderRoot.querySelectorAll<BeuveSuggestionField>('.editor beuve-suggestion-field'),
      ].find((candidate) => candidate.field?.key === key);
      element?.focus();
    });
  }

  private async revealCursor(): Promise<void> {
    await this.updateComplete;
    this.renderRoot.querySelector('li.cursor')?.scrollIntoView({ block: 'nearest' });
  }

  private chooseVerdict(value: string): void {
    let chosen: UraVerdictView | undefined;
    if (value !== '') {
      chosen = value as UraVerdictView;
    }
    const resolved = resolveNoteListVerdict(chosen, this.derivedVerdict, this.blockingCount());
    this.verdictRefusal = resolved.refusal ?? '';
    if (resolved.refusal === undefined) {
      this.emit('beuve-ura-set-verdict', { verdict: chosen });
    }
  }

  private blockingCount(): number {
    return this.items.filter((item) => item.status.kind === 'staged' && item.blocking).length;
  }

  private exportTo(target: UraExportTarget): void {
    this.emit('beuve-ura-export', { target });
  }

  /**
   * One note (ADR 0154): its label's emoji in a column of its own, then what it says, its path,
   * and the facts that differ from the default, if any (Blocking, Outdated, Posted, Addressed or
   * Withdrawn, then ✨ for an agent's note). The cursor row adds the suggestion's preview.
   */
  private renderItem(item: UraItemView, index: number): TemplateResult {
    const labels = describeUraItem(item);
    const isCursor = index === this.cursor;
    const isSelected = this.selection.selected.includes(item.id);
    const classes = [
      isCursor && 'cursor',
      isSelected && 'selected',
      item.status.kind !== 'staged' && 'closed',
      this.draggedIds.includes(item.id) && 'dragging',
      this.dropTarget?.id === item.id && `drop-${this.dropTarget.side}`,
    ].filter((name) => name !== false);
    const isDraggable = item.status.kind === 'staged' && this.editingId !== item.id;
    return html`<li
      class=${classes.join(' ')}
      data-action="item"
      data-item-id=${item.id}
      aria-selected=${isSelected ? 'true' : 'false'}
      draggable=${isDraggable ? 'true' : 'false'}
    >
      <span
        class="note-kind"
        role="img"
        aria-label=${labels.severityName}
        title=${labels.severityName}
        >${uraSeverityEmoji(item.severity)}</span
      >
      <div class="note-content">
        ${this.renderNoteText(item)}
        ${
          item.suggestions.length > 0 &&
          hasNoteText(item) &&
          (isCursor || this.editingId === item.id)
            ? html`<beuve-patch-preview
                .patch=${suggestionPreviewFrom(item) ?? ''}
              ></beuve-patch-preview>`
            : nothing
        }
        ${
          item.anchor.kind === 'change'
            ? html`<span class="note-path whole">Whole change</span>`
            : html`<span class="note-path" title=${labels.anchor}
                ><bdi>${pathText(labels.anchor)}</bdi></span
              >`
        }
        ${this.renderMarks(item, isCursor)}
      </div>
      ${this.editingId === item.id ? this.renderEditor(item) : nothing}
    </li>`;
  }

  /** What the note says: its title, else its body, else its suggestion (ADR 0154). */
  private renderNoteText(item: UraItemView): TemplateResult {
    if (item.title !== '') {
      return html`<span class="note-title"
        >${parseInlineTitle(item.title).map((span) => renderInlineSpan(span))}</span
      >`;
    }
    const body = item.body.trim();
    const preview = suggestionPreviewFrom(item);
    if (body !== '' || preview === undefined) {
      return html`<span class="note-text"
        >${parseInlineTitle(body.replaceAll(/\s+/gu, ' ')).map((span) => renderInlineSpan(span))}</span
      >`;
    }
    return html`<beuve-patch-preview .patch=${preview}></beuve-patch-preview>`;
  }

  /** The words for what is marked, then ✨ for an agent's note, the least of them; nothing when nothing is. */
  private renderMarks(item: UraItemView, isCursor: boolean): TemplateResult | typeof nothing {
    const marks = noteMarksFrom(item);
    const isAgent = item.origin.kind !== 'human';
    if (!isAgent && marks.length === 0) {
      return nothing;
    }
    return html`<span class="note-marks">
      ${marks.map((mark) => {
        return html`<span class="mark mark-${mark.kind}" title=${mark.title}>${mark.text}</span>`;
      })}
      ${
        isAgent
          ? html`<beuve-agent-mark
              .origin=${item.origin}
              ?focusable=${isCursor}
            ></beuve-agent-mark>`
          : nothing
      }
    </span>`;
  }

  /**
   * The selection's count and its label menu (ADR 0144): a label choice relabels every selected
   * note, and Blocking blocks them all, or none when all of them block already.
   */
  private renderSelectionBar(): TemplateResult | typeof nothing {
    if (this.selection.selected.length === 0) {
      return nothing;
    }
    const targets = this.targetItems();
    const state = noteLabelStateFrom(targets);
    let severity: UraSeverityView = 'issue';
    if (state.severity !== 'mixed') {
      severity = state.severity;
    }
    return html`<div class="selection" role="group" aria-label="Selected notes">
      <span class="selection-count" role="status"
        >${countNoun(targets.length, 'note')} selected</span
      >
      <beuve-ura-label-menu
        .severity=${live(severity)}
        .blocking=${live(state.blocking === true)}
        .mixedSeverity=${live(state.severity === 'mixed')}
        .mixedBlocking=${live(state.blocking === 'mixed')}
      ></beuve-ura-label-menu>
      <span class="spacer"></span>
      <button
        class="button"
        type="button"
        title="Clear the selection (Esc)"
        data-action="clear-selection"
      >
        Clear
      </button>
    </div>`;
  }

  private renderEditor(item: UraItemView): TemplateResult {
    return html`<form class="editor" data-action="editor" data-item-id=${item.id}>
      <div class="row">
        <beuve-ura-label-menu
          .severity=${this.editingSeverity}
          ?blocking=${this.editingBlocking}
        ></beuve-ura-label-menu>
        <input
          class="field"
          name="title"
          aria-label="Title"
          placeholder="Title (optional)"
          maxlength="200"
          role="combobox"
          aria-expanded="false"
          aria-autocomplete="list"
          aria-controls="emoji-completions"
          data-emoji-completion
          .value=${item.title}
        />
      </div>
      <textarea
        name="body"
        aria-label="Body"
        aria-autocomplete="list"
        aria-controls="emoji-completions"
        data-emoji-completion
        .value=${item.body}
      ></textarea>
      ${
        this.editingSuggestions.length === 0
          ? nothing
          : html`<div class="suggestions">
              ${repeat(
                this.editingSuggestions,
                (field) => {
                  return field.key;
                },
                (field) => {
                  return html`<beuve-suggestion-field .field=${field}></beuve-suggestion-field>`;
                },
              )}
            </div>`
      }
      ${
        this.suggestionNotice === ''
          ? nothing
          : html`<span class="suggestion-notice" role="status">${this.suggestionNotice}</span>`
      }
      <div class="row">
        <beuve-note-expand
          .anchor=${item.anchor}
          .headSha=${item.headSha}
          .noteKey=${item.id}
        ></beuve-note-expand>
        <button class="button" type="button" data-action="add-suggestion" data-item-id=${item.id}>
          Add suggestion
        </button>
        <span class="spacer"></span>
        <button class="button" type="button" title="Cancel (Esc)" data-action="cancel-edit">
          Cancel
        </button>
        <button type="submit" class="button primary" title=${`Save (${this.saveKey()})`}>
          Save
        </button>
      </div>
    </form>`;
  }

  private renderExport(stagedCount: number): TemplateResult {
    const verdict = resolveNoteListVerdict(
      this.chosenVerdict,
      this.derivedVerdict,
      this.blockingCount(),
    );
    return html`<section>
      <h2>Export</h2>
      <label class="verdict">
        <span>Verdict</span>
        <select
          class="field"
          aria-label="Verdict"
          .value=${live(verdict.source === 'chosen' ? verdict.value : '')}
          @change=${(event: Event): void => {
            this.chooseVerdict((event.target as HTMLSelectElement).value);
          }}
        >
          <option value="" ?selected=${verdict.source === 'derived'}>
            ${verdictLabels[this.derivedVerdict]} (derived)
          </option>
          ${(['approve', 'comment', 'request-changes'] as const)
            .filter((value) => value !== this.derivedVerdict)
            .map((value) => {
              return html`<option value=${value} ?selected=${this.chosenVerdict === value}>
                ${verdictLabels[value]}
              </option>`;
            })}
        </select>
      </label>
      ${this.renderVerdictNote()}
      ${this.github === undefined ? nothing : this.renderGithub(this.github)}
      ${this.renderExports()}
      ${
        this.notice === undefined
          ? nothing
          : html`<p class="note ${this.notice.tone}" role="status">${this.notice.text}</p>`
      }
      ${
        stagedCount === 0
          ? html`<p class="note">Nothing staged: an export carries only the verdict.</p>`
          : nothing
      }
    </section>`;
  }

  /**
   * The copy buttons: Copy as XML and Copy as JSON sit beside Post review when posting is offered
   * (in `renderPostActions`), and here otherwise; the GitHub JSON copy only where posting isn't.
   */
  private renderExports(): TemplateResult | typeof nothing {
    const targets: NoteListExportTarget[] = [];
    if (this.github?.isSignedIn !== true) {
      targets.push('agent-xml', 'agent-json');
    }
    if (this.github === undefined) {
      targets.push('github');
    }
    if (targets.length === 0) {
      return nothing;
    }
    return html`<div class="exports">
      ${targets.map((target) => {
        return this.renderExportButton(target);
      })}
    </div>`;
  }

  private renderExportButton(target: NoteListExportTarget): TemplateResult {
    const { label, title } = noteListExports[target];
    return html`<button
      class="button"
      type="button"
      title=${title}
      ?disabled=${!this.hasSession || this.exporting}
      data-action="export"
      data-target=${target}
    >
      ${label}
    </button>`;
  }

  /**
   * Review edits (ADR 0088), quietly: the branch and how much work it holds, with Open, Turn into
   * Suggestions and Discard; then the preview of what staging does, or of what discarding loses,
   * each confirmed before anything happens. Keys live in the menus' tooltips, not here.
   */
  private renderReviewEdits(): TemplateResult | typeof nothing {
    const state = this.reviewEdits;
    const view = state?.view;
    if (state === undefined || (view?.exists !== true && state.flow.kind === 'idle')) {
      return nothing;
    }
    const { flow } = state;
    return html`<section class="review-edits" aria-label="Review edits">
      ${
        view?.exists === true
          ? html`<p class="note" title=${view.path ?? view.branch}>
                Review edits on <code><bdi>${pathText(view.branch)}</bdi></code
                >: ${describeEditCounts(view)}${view.isOnSessionHead ? '' : ', on an older head'}
              </p>
              <div class="actions">
                <button class="button" type="button" data-action="review-edits" data-op="open">
                  Open
                </button>
                <button class="button" type="button" data-action="review-edits" data-op="preview">
                  Turn into suggestions…
                </button>
                <button
                  class="button"
                  type="button"
                  data-action="review-edits"
                  data-op="discard-preview"
                >
                  Discard…
                </button>
              </div>`
          : nothing
      }
      ${this.renderReviewEditsFlow(flow)}
    </section>`;
  }

  /** A harvested item's diffs: each suggestion under its lines, or the note's diff (ADR 0162). */
  private renderHarvestDiffs(edit: ReviewEditPreviewView): TemplateResult {
    if (edit.kind === 'note') {
      return html`<beuve-patch-preview .patch=${edit.diff}></beuve-patch-preview>`;
    }
    return html`<ol class="harvest-suggestions">
      ${edit.suggestions.map((suggestion) => {
        return html`<li>
          <span class="anchor"
            ><bdi>${pathText(describeSuggestionLines(suggestion).heading)}</bdi></span
          >
          <beuve-patch-preview .patch=${suggestion.diff}></beuve-patch-preview>
        </li>`;
      })}
    </ol>`;
  }

  private renderReviewEditsFlow(flow: ReviewEditsFlow): TemplateResult | typeof nothing {
    switch (flow.kind) {
      case 'idle': {
        return nothing;
      }
      case 'busy': {
        return html`<p class="note" role="status">${flow.text}</p>`;
      }
      case 'done': {
        return html`<p class="note posted" role="status">${flow.text}</p>`;
      }
      case 'failed': {
        return html`<p class="note error" role="alert">${flow.text}</p>`;
      }
      case 'preview': {
        const staged = flow.plan.edits.filter((edit) => edit.action !== 'unchanged');
        return html`<div class="github confirm" role="group" aria-label="Confirm staging">
          <p class="note">${describeHarvest(flow.plan.edits)}</p>
          <ol class="harvest" aria-label="What staging does">
            ${staged.map((edit) => {
              return html`<li>
                <div class="meta">
                  <span class="severity issue">${harvestActionLabels[edit.action]}</span>
                  <span class="anchor"><bdi>${pathText(anchorLabel(edit.anchor))}</bdi></span>
                </div>
                <div class="title">${edit.title}</div>
                ${this.renderHarvestDiffs(edit)}
              </li>`;
            })}
          </ol>
          <div class="actions">
            <button class="button" type="button" data-action="review-edits" data-op="cancel">
              Cancel
            </button>
            <button
              type="button"
              class="button primary"
              ?disabled=${staged.length === 0}
              data-action="review-edits"
              data-op="stage"
            >
              Stage
            </button>
          </div>
        </div>`;
      }
      case 'discard': {
        const { loss } = flow;
        return html`<div class="github confirm" role="group" aria-label="Confirm discarding">
          <p class="note">
            Discard <code><bdi>${pathText(loss.branch)}</bdi></code> and its worktree? This loses
            ${describeEditCounts({ files: loss.files.length, commits: loss.commits })}, and can't be
            undone.
          </p>
          <ul class="harvest" aria-label="Files that would be lost">
            ${loss.files.map((file) => {
              return html`<li><bdi>${pathText(file)}</bdi></li>`;
            })}
          </ul>
          <div class="actions">
            <button class="button" type="button" data-action="review-edits" data-op="cancel">
              Cancel
            </button>
            <button
              type="button"
              class="button danger"
              data-action="review-edits"
              data-op="discard"
            >
              Discard
            </button>
          </div>
        </div>`;
      }
    }
  }

  /**
   * Post to GitHub, in one step (ADR 0039 amendment 2026-11-18): the summary field, then the line
   * naming the target and what goes inline and into the body, right above the Post button, which
   * posts at once. GitHub refusing an approval on the reviewer's own pull request offers posting
   * as a comment in the button's place; after a post the same form posts again.
   */
  private renderGithub(github: GithubNoteListState): TemplateResult {
    if (!github.isSignedIn) {
      return html`<p class="note">Post to ${github.target}: ${github.signInHint}</p>`;
    }
    const { post } = github;
    return html`<div class="github" role="group" aria-label="Post to GitHub">
      ${
        post.kind === 'posted'
          ? html`<p class="note" role="status">
              ${post.text}
              <button
                type="button"
                class="button link"
                title=${post.url}
                @click=${(): void => {
                  this.emit('beuve-open-link', { url: post.url });
                }}
              >
                View on GitHub
              </button>
            </p>`
          : nothing
      }
      <textarea
        name="summary"
        aria-label="Review summary"
        placeholder="Summary (Markdown, optional)"
        title="The text at the top of the review, above the items that aren't attached to a line"
        ?readonly=${post.kind === 'busy'}
        aria-autocomplete="list"
        aria-controls="emoji-completions"
        data-emoji-completion
        .value=${live(this.summary)}
        @input=${(event: InputEvent): void => {
          this.summary = (event.target as HTMLTextAreaElement).value;
        }}
      ></textarea>
      <p class="note" id="github-preview">
        Post to ${github.target}: ${describePostPreview(github.preview)}
      </p>
      ${this.renderPostNote(post)} ${this.renderPostActions(github)}
    </div>`;
  }

  /** Why the last post didn't go out, or that it is going out. */
  private renderPostNote(post: GithubPostState): TemplateResult | typeof nothing {
    switch (post.kind) {
      case 'busy': {
        return html`<p class="note" role="status">${post.text}</p>`;
      }
      case 'failed': {
        return html`<p class="note error" role="alert">${post.text}</p>`;
      }
      case 'head-moved': {
        return html`<p class="note" role="status">
          The PR changed since you opened this; review the new commits first.
        </p>`;
      }
      case 'own-pull-request': {
        return html`<p class="note" role="alert">${post.message} Post as comment instead?</p>`;
      }
      case 'idle':
      case 'posted': {
        return nothing;
      }
    }
  }

  private renderPostActions(github: GithubNoteListState): TemplateResult {
    const { post } = github;
    if (post.kind === 'own-pull-request') {
      return html`<div class="actions">
        ${this.renderExportButton('agent-xml')} ${this.renderExportButton('agent-json')}
        <span class="spacer"></span>
        <button
          class="button"
          type="button"
          @click=${(): void => {
            this.emit('beuve-github-cancel', {});
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          class="button primary"
          aria-describedby="github-preview"
          @click=${(): void => {
            this.emit('beuve-github-post', { verdict: 'comment', summary: this.writtenSummary() });
          }}
        >
          Post as comment
        </button>
      </div>`;
    }
    let label = 'Post review';
    if (post.kind === 'posted') {
      label = 'Post again';
    }
    return html`<div class="actions">
      ${this.renderExportButton('agent-xml')} ${this.renderExportButton('agent-json')}
      <button
        type="button"
        class="button primary"
        aria-describedby="github-preview"
        ?disabled=${!this.hasSession || post.kind === 'busy' || github.preview.kind === 'loading'}
        title="Post the staged items as one review on ${github.target}, now"
        @click=${(): void => {
          this.emit('beuve-github-post', { summary: this.writtenSummary() });
        }}
      >
        ${label}
      </button>
    </div>`;
  }

  /**
   * The open notes, then the closed ones under their own heading (ADR 0154), which collapses and
   * expands them: it runs Show Closed Notes (ADR 0149 amendment).
   */
  private renderLists(ordered: readonly UraItemView[]): TemplateResult {
    const openCount = ordered.filter((item) => item.status.kind === 'staged').length;
    const closed = ordered.slice(openCount);
    return html`${
        openCount === 0 && !this.showClosed
          ? html`<p class="empty">Every note is closed.</p>`
          : nothing
      }
      <ol
        ?hidden=${openCount === 0}
        aria-label="Open notes"
        aria-multiselectable="true"
        data-action="list"
      >
        ${ordered.slice(0, openCount).map((item, index) => this.renderItem(item, index))}
      </ol>
      ${this.renderClosedHeading()}
      ${
        closed.length === 0
          ? nothing
          : html`<ol aria-labelledby="closed-notes" aria-multiselectable="true" data-action="list">
              ${closed.map((item, index) => this.renderItem(item, openCount + index))}
            </ol>`
      }`;
  }

  /** The Closed heading, a disclosure button with the count, listed or hidden. */
  private renderClosedHeading(): TemplateResult | typeof nothing {
    const count = this.items.filter((item) => item.status.kind !== 'staged').length;
    if (count === 0) {
      return nothing;
    }
    let title = 'Hide closed notes: addressed and withdrawn';
    if (!this.showClosed) {
      title = 'Show closed notes: addressed and withdrawn';
    }
    return html`<h3 class="list-heading">
      <button
        type="button"
        id="closed-notes"
        aria-expanded=${String(this.showClosed)}
        data-action="toggle-closed"
        title=${title}
      >
        <span class="list-chevron" aria-hidden="true"></span>Closed
        <span class="list-count">${count}</span>
      </button>
    </h3>`;
  }

  private saveKey(): string {
    const platform = keyPlatformOf(this.platform);
    return displayAccelerator(saveAccelerators[platform], platform);
  }

  /** Why the chosen verdict was refused, else what changed it. */
  private renderVerdictNote(): TemplateResult {
    if (this.verdictRefusal !== '') {
      return html`<p class="note error" role="alert">${this.verdictRefusal}</p>`;
    }
    if (this.verdictNotice !== '') {
      return html`<p class="note" role="status">${this.verdictNotice}</p>`;
    }
    return html``;
  }

  /**
   * Runs a Note menu command, or Open in Editor: Show, Edit and Open in Editor on the note
   * under the cursor, the others on every selected note (ADR 0144).
   */
  runCommand(id: CommandId): boolean {
    const ordered = this.ordered();
    const current = ordered[this.cursor];
    const targets = this.targetItems();
    const status = statusOfCommand[id];
    if (status !== undefined) {
      this.setStatus(targets, status);
      return true;
    }
    const severity = severityOfCommand[id];
    if (severity !== undefined) {
      this.emitChange(targets, { kind: 'severity', severity });
      return true;
    }
    switch (id) {
      case 'note-move':
      case 'note-extend-selection':
      case 'note-clear-selection': {
        return true;
      }
      case 'note-select-all': {
        this.select({ kind: 'all' });
        return true;
      }
      case 'note-move-up': {
        this.move(targets, -1);
        return true;
      }
      case 'note-move-down': {
        this.move(targets, 1);
        return true;
      }
      case 'note-show': {
        if (current !== undefined) {
          this.emit('beuve-ura-jump', { item: current });
        }
        return true;
      }
      case 'open-in-editor': {
        if (current !== undefined) {
          this.openInEditor(current);
        }
        return true;
      }
      case 'note-edit': {
        if (current !== undefined) {
          this.toggleEditor(current);
        }
        return true;
      }
      case 'note-withdraw': {
        this.toggleStatus(targets, 'withdrawn');
        return true;
      }
      case 'note-delete': {
        if (targets.length > 0) {
          this.emit('beuve-ura-delete', { itemIds: targets.map((item) => item.id) });
          this.selection = { selected: [], anchor: undefined };
        }
        return true;
      }
      case 'note-addressed': {
        this.toggleStatus(targets, 'addressed');
        return true;
      }
      case 'note-blocking': {
        this.toggleBlocking(targets);
        return true;
      }
      case 'note-change-label': {
        this.changeLabel(current);
        return true;
      }
      default: {
        return false;
      }
    }
  }

  /**
   * Puts the cursor on item `itemId`, for a context menu opened on it; a note outside the
   * selection clears it, so the menu acts on the note it was opened on.
   */
  selectItem(itemId: string): void {
    const index = this.ordered().findIndex((item) => item.id === itemId);
    if (index !== -1) {
      this.cursor = index;
    }
    if (!this.selection.selected.includes(itemId)) {
      this.selection = { selected: [], anchor: undefined };
    }
  }

  /** Puts the keyboard on the GitHub review summary, if posting is offered. */
  focusPostSummary(): void {
    void this.updateComplete.then(() => {
      this.renderRoot.querySelector<HTMLElement>('textarea[name="summary"]')?.focus();
    });
  }

  /** The summary the reviewer wrote, or `undefined` when they left it blank; exports carry it too. */
  writtenSummary(): string | undefined {
    if (this.summary.trim() === '') {
      return undefined;
    }
    return this.summary;
  }

  /** The notes a Note command acts on: the selected ones in note order, else the cursor's. */
  targetItems(): UraItemView[] {
    const { selected } = this.selection;
    if (selected.length > 0) {
      return this.ordered().filter((item) => selected.includes(item.id));
    }
    const current = this.cursorItem();
    if (current === undefined) {
      return [];
    }
    return [current];
  }

  /** The item under the notes list's cursor, which Add to Chat adds by its anchor (ADR 0046). */
  cursorItem(): UraItemView | undefined {
    return this.ordered()[this.cursor];
  }

  override render(): TemplateResult {
    const ordered = this.ordered();
    const stagedCount = this.items.filter((item) => item.status.kind === 'staged').length;
    return html`
      <div class="body">
        <section>
          ${
            ordered.length === 0 && this.items.length === 0
              ? html`<p class="empty">
                  ${
                    this.hasSession
                      ? 'Nothing staged yet. Choose Note ▸ Add Note on a diff selection, or Stage on a chat answer.'
                      : 'Open a review session to stage notes.'
                  }
                </p>`
              : html`${this.renderSelectionBar()} ${this.renderLists(ordered)}`
          }
        </section>
        ${this.renderReviewEdits()}
      </div>
      <footer class="export">${this.renderExport(stagedCount)}</footer>
      ${this.emoji.render()}
    `;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('items') || changed.has('showClosed')) {
      const listed = this.ordered();
      this.cursor = Math.min(this.cursor, Math.max(0, listed.length - 1));
      const present = new Set(listed.map((item) => item.id));
      if (this.selection.selected.some((id) => !present.has(id))) {
        const selected = this.selection.selected.filter((id) => present.has(id));
        let { anchor } = this.selection;
        if (anchor === undefined || !present.has(anchor) || selected.length === 0) {
          anchor = selected[0];
        }
        this.selection = { selected, anchor };
      }
      const followed = this.ordered().findIndex((item) => item.id === this.cursorFollows);
      if (followed !== -1) {
        this.cursor = followed;
        this.cursorFollows = undefined;
      }
      if (this.items.every((item) => item.id !== this.editingId)) {
        this.editingId = undefined;
      }
    }
    if (changed.has('chosenVerdict') || changed.has('verdictNotice')) {
      this.verdictRefusal = '';
    }
    if (!changed.has('github')) {
      return;
    }
    const before = changed.get('github');
    const isNewlyPosted = this.github?.post.kind === 'posted' && before?.post.kind !== 'posted';
    if (isNewlyPosted || before?.target !== this.github?.target) {
      this.summary = '';
    }
  }
}

/** What the diff answers `beuve-suggestion-target` with: its selected lines and their head, or why there are none. */
export type SuggestionTargetAnswer =
  | { readonly kind: 'lines'; readonly lines: SuggestionLines; readonly headSha: string }
  | { readonly kind: 'refused'; readonly reason: string };

/** `beuve-suggestion-target`: the notes list asks the review for the diff's selected lines. */
export interface SuggestionTargetRequestDetail {
  readonly respond: (answer: SuggestionTargetAnswer) => void;
}

/** Where dragged notes would land: before or after the staged note `id`. */
interface DropTarget {
  readonly id: string;
  readonly side: 'before' | 'after';
}

/** A `dragover` and the note element it is over. */
interface DragOverPlace {
  readonly event: DragEvent;
  readonly element: Element;
}

/** The drag data's type: the dragged ids, which no text field takes as a drop. */
const dragType = 'application/x-beuve-ura-items';

/** A note's status, as the context menu's Status sets it. */
type UraStatusKind = UraItemView['status']['kind'];

/** The status each of the context menu's Status commands sets (ADR 0150). */
const statusOfCommand: Readonly<Partial<Record<CommandId, UraStatusKind>>> = {
  'note-status-open': 'staged',
  'note-status-addressed': 'addressed',
  'note-status-withdrawn': 'withdrawn',
};

/** The action that brings a note to each status (ADR 0151). */
const statusActions = {
  staged: 'reopen',
  withdrawn: 'withdraw',
  addressed: 'mark-addressed',
} as const satisfies Readonly<Record<UraStatusKind, UraItemsChange['kind']>>;

/** The label each of the context menu's Label commands sets (ADR 0150). */
const severityOfCommand: Readonly<Partial<Record<CommandId, UraSeverityView>>> = Object.fromEntries(
  uraSeverityViews.map((severity) => {
    return [`note-label-${severity}`, severity];
  }),
);

const inPlaceKeys: Readonly<Record<string, CommandId>> = {
  Enter: 'note-show',
  ' ': 'note-edit',
  Delete: 'note-withdraw',
  Backspace: 'note-withdraw',
  'Shift+Delete': 'note-delete',
  'Shift+Backspace': 'note-delete',
  'Alt+ArrowUp': 'note-move-up',
  'Alt+ArrowDown': 'note-move-down',
};

/** ⌘/Ctrl+Enter in the editor saves, as Enter in its title does. */
const harvestActionLabels: Readonly<Record<ReviewEditPreviewView['action'], string>> = {
  create: 'new',
  attach: 'attach',
  update: 'update',
  unchanged: 'staged',
};

/** `path:lines`, the path, or `whole change`, as the preview names where an edit goes. */
function anchorLabel(anchor: UraAnchorView): string {
  if (anchor.kind === 'lines') {
    if (anchor.startLine === anchor.endLine) {
      return `${anchor.path}:${String(anchor.startLine)}`;
    }
    return `${anchor.path}:${String(anchor.startLine)}-${String(anchor.endLine)}`;
  }
  if (anchor.kind === 'file') {
    return anchor.path;
  }
  return 'whole change';
}

function submitOnModEnter(event: KeyboardEvent, form: HTMLFormElement): void {
  // A suggestion field saves through its own event.
  if (event.defaultPrevented || event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) {
    return;
  }
  event.preventDefault();
  form.requestSubmit();
}

/** Typing in the editor is never a notes list shortcut. */
function isTextEntry(event: KeyboardEvent): boolean {
  const [target] = event.composedPath();
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/** A key or label change in the selection bar is the bar's, not the list's or the editor's. */
function isInSelectionBar(event: Event): boolean {
  return event.composedPath().some((target) => {
    return target instanceof Element && target.matches('.selection');
  });
}

/** A key in the open editor (its label menu, its buttons) is the editor's, not the notes list's. */
function isInEditor(event: KeyboardEvent): boolean {
  return event.composedPath().some((target) => {
    return target instanceof Element && target.matches('.editor');
  });
}

const saveAccelerators: Readonly<Record<KeyPlatform, string>> = {
  mac: 'Cmd+Return',
  linux: 'Ctrl+Return',
};

/** The status word on a finished item; none on a staged one. */
/** Whether the note says something in words, so a suggestion is extra rather than its content. */
function hasNoteText(item: UraItemView): boolean {
  return item.title !== '' || item.body.trim() !== '';
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-note-list': BeuveNoteList;
  }
}

/** An inline span of an item's title as a template: text stays text, never HTML. */
function renderInlineSpan(span: InlineSpan): TemplateResult | string {
  switch (span.kind) {
    case 'text': {
      return span.text;
    }
    case 'code': {
      return html`<code>${span.text}</code>`;
    }
    case 'strong': {
      return html`<strong>${span.text}</strong>`;
    }
    case 'emphasis': {
      return html`<em>${span.text}</em>`;
    }
  }
}
