import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';

import type {
  ReviewEditPreviewView,
  UraAnchorView,
  UraExportTarget,
  UraItemView,
  UraSeverityView,
  UraVerdictView,
} from '#contract/ipc-contract.ts';

import type { CommandId, KeyPlatform } from '#contract/command-catalog.ts';

import './beuve-note-expand.ts';
import './beuve-patch-preview.ts';
import { ActionDelegation } from './action-delegation.ts';
import { withPayload } from './with-payload.ts';
import { displayAccelerator } from './display-accelerator.ts';
import { keyPlatformOf } from './key-platform-of.ts';
import { describePostPreview } from './describe-post-preview.ts';
import { describeUraItem } from './describe-ura-item.ts';
import type { GithubDockState, GithubPostState } from './github-post-state.ts';
import type { ReviewEditsDockState, ReviewEditsFlow } from './review-edits-state.ts';
import { describeHarvest } from './describe-harvest.ts';
import { describeEditCounts } from './describe-edit-counts.ts';
import { dropUraItems } from './drop-ura-items.ts';
import { moveUraItems } from './move-ura-items.ts';
import { noteStatusChange } from './note-status-change.ts';
import { dockSelectionAfter } from './dock-selection-after.ts';
import type { DockGesture, DockSelection } from './dock-selection-after.ts';
import { countNoun } from './count-noun.ts';
import { createUraNoteIcon } from './create-ura-note-icon.ts';
import { headlineOfUraItem } from './headline-of-ura-item.ts';
import { parseInlineTitle } from './parse-inline-title.ts';
import './beuve-ura-label-menu.ts';
import type { UraLabelChange } from './beuve-ura-label-menu.ts';
import type { InlineSpan } from './parse-markdown-subset.ts';
import { noteLabelStateFrom } from './note-label-state-from.ts';
import { resolveDockVerdict } from './resolve-dock-verdict.ts';
import { zoneStyles } from './zone-styles.ts';
import { formatControlStyles } from './format-control-styles.ts';
import { pathText } from './path-text.ts';
import { buttonStyles } from './primitives/button-styles.ts';
import { fieldStyles } from './primitives/field-styles.ts';
import { completionListStyles } from './completion-list-styles.ts';
import { EmojiCompletion } from './emoji-completion.ts';
import { emojiCompletionStyles } from './emoji-completion-styles.ts';

/** A status line under the export buttons; `tone` colors it. */
export interface DockNotice {
  readonly tone: 'info' | 'error';
  readonly text: string;
}

const verdictLabels: Readonly<Record<UraVerdictView, string>> = {
  approve: 'Approve',
  comment: 'Comment',
  'request-changes': 'Request changes',
};

/** The exports the dock offers as buttons; File › Export Review has all of them. */
type DockExportTarget = Extract<UraExportTarget, 'agent-xml' | 'agent-json' | 'github'>;

interface DockExport {
  readonly label: string;
  readonly title: string;
}

const dockExportTargets: readonly DockExportTarget[] = ['agent-xml', 'agent-json', 'github'];

const dockExports: Readonly<Record<DockExportTarget, DockExport>> = {
  'agent-xml': {
    label: 'Copy as XML',
    title: 'Copy the review as XML for Claude Code (beuve.ura/1), summary included',
  },
  'agent-json': {
    label: 'Copy as JSON',
    title: 'Copy the same review as JSON for agents (beuve.ura/1), summary included',
  },
  github: {
    label: 'Copy GitHub review (JSON)',
    title: 'The body of POST /repos/{owner}/{repo}/pulls/{number}/reviews, summary included',
  },
};

/**
 * Zone 3: the Universal Review Artifact staging dock (ADR 0023, 0027). Lists the session's staged
 * items in export order (severity, `path:lines` on the current head, title, origin, and an
 * outdated marker), then the withdrawn and addressed ones. While the zone has focus: ↑/↓ move,
 * Return jumps the diff stream to the item, Space opens its editor (label, Blocking, title, body),
 * Delete withdraws or restores it, Shift+Delete deletes it and ⌥↑/⌥↓ move it up or down the
 * export order, as dragging a staged note among the staged ones does (ADR 0144); a double-click
 * edits it too (ADR 0129). ⇧↑/⇧↓, Shift+click and ⌘/Ctrl+click select several notes, ⌘A / Ctrl+A
 * selects them all and Escape clears the selection; the Note commands but Show and Edit then act
 * on every selected note, and a bar above the list shows the count and relabels them (ADR 0144).
 * Review ▸ Note and the context menu run the same commands (`runCommand`, ADR 0068), and Open in
 * Editor opens it (`beuve-open-editor`). A verdict selector shows the derived default and refuses
 * approving over a staged blocking note; export buttons copy the compiled review. Items carrying
 * a suggested patch say `patch` and preview it under the cursor; the editor can re-edit the
 * suggestion in the diff stream or remove it (ADR 0043). Presentational: emits
 * `beuve-ura-edit-suggestion`, `beuve-ura-jump`, `beuve-ura-update`, `beuve-ura-edit-many`,
 * `beuve-ura-delete`, `beuve-ura-reorder` and `beuve-ura-export`; `beuve-app` does the IPC.
 */
@customElement('beuve-ura-dock')
export class BeuveUraDock extends LitElement {
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

      li.done {
        opacity: 0.6;
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

      li.done .title {
        text-decoration: line-through;
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

      .suggestion {
        flex: none;
        color: var(--beuve-accent);
      }

      beuve-patch-preview {
        margin-block-start: var(--beuve-space-1);
      }

      .editor .suggestion-actions {
        display: flex;
        align-items: center;
        gap: var(--beuve-space-1);
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

  /** `:shortcode:` emoji in the editor's title and body and the review summary (ADR 0145). */
  private readonly emoji = new EmojiCompletion(this);

  /**
   * The dock's in-place keys (ADR 0068, 0144): ↑/↓ move, ⇧↑/⇧↓ extend the selection, ⌘A / Ctrl+A
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
      this.runCommand('dock-select-all');
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
  /** The open session's items in dock order, every status (`ura:list`). */
  @property({ attribute: false }) accessor items: readonly UraItemView[] = [];
  /** Whether addressed notes are listed (View preference `showAddressedNotes`, ADR 0149). */
  @property({ type: Boolean }) accessor showAddressed = true;
  @property() accessor derivedVerdict: UraVerdictView = 'approve';
  /** The verdict stored for the session (`ura:list`); absent when the derived one applies. */
  @property() accessor chosenVerdict: UraVerdictView | undefined;
  /** Why a stored verdict was dropped, shown until the reviewer chooses again. */
  @property() accessor verdictNotice = '';
  @property({ attribute: false }) accessor notice: DockNotice | undefined;
  /** Set by the owner while an export is being compiled and copied. */
  @property({ type: Boolean }) accessor exporting = false;
  /** Set for pull request sessions: posting to GitHub replaces copying the review JSON. */
  @property({ attribute: false }) accessor github: GithubDockState | undefined;

  @state() accessor cursor = 0;
  /** The notes picked besides the cursor (ADR 0144); empty is the cursor's note alone. */
  @state() accessor selection: DockSelection = { selected: [], anchor: undefined };
  /** Where a note being dragged would land (ADR 0144); absent while nothing is dragged over one. */
  @state() accessor dropTarget: DropTarget | undefined;
  /** The notes being dragged, while a drag from the list runs. */
  @state() accessor draggedIds: readonly string[] = [];
  @state() accessor editingId: string | undefined;
  /** The open editor's label and Blocking, which start from the note's own (ADR 0131). */
  @state() accessor editingSeverity: UraSeverityView = 'issue';
  @state() accessor editingBlocking = false;
  @state() accessor verdictRefusal = '';
  /** The review summary being written; kept until it is posted or another pull request opens. */
  @state() accessor summary = '';

  /** `process.platform`, for the Save button's tooltip. */
  @property() accessor platform = '';

  /** The session's review edits (ADR 0088); shown only once they exist or an action runs. */
  @property({ attribute: false }) accessor reviewEdits: ReviewEditsDockState | undefined;

  constructor() {
    super();
    this.addEventListener('keydown', this.onKeyDown);
    this.addEventListener('beuve-ura-label-change', this.onLabelChange as EventListener);
    // ADR 0074: the items, their editor and the export buttons, through one listener per type.
    this.addController(
      new ActionDelegation(this, {
        click: {
          'show-addressed': (_data, event): void => {
            event.stopPropagation();
            this.emit('beuve-ura-show-addressed', undefined);
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
          'edit-suggestion': withPayload(
            ({ itemId }) => {
              return this.itemOf(itemId);
            },
            (found, event): void => {
              event.stopPropagation();
              this.closeEditor();
              this.emit('beuve-ura-edit-suggestion', { itemId: found.id });
            },
          ),
          'remove-suggestion': withPayload(
            ({ itemId }) => {
              return this.itemOf(itemId);
            },
            (found, event): void => {
              event.stopPropagation();
              this.emit('beuve-ura-update', { itemId: found.id, suggestedPatch: '' });
            },
          ),
          export: withPayload(
            ({ target }) => {
              return dockExportTargets.find((candidate) => candidate === target);
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

  private select(gesture: DockGesture): void {
    this.selection = dockSelectionAfter(this.selection, {
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

  /** ⌘A on macOS, Ctrl+A elsewhere: the dock's Select All Notes while the list has the focus. */
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
   * The listed items: staged ones first, in export order, then withdrawn and addressed ones,
   * leaving out the addressed ones while they are hidden (ADR 0149).
   */
  private ordered(): UraItemView[] {
    return [
      ...this.items.filter((item) => item.status.kind === 'staged'),
      ...this.items.filter((item) => item.status.kind !== 'staged' && this.isListed(item)),
    ];
  }

  private isListed(item: UraItemView): boolean {
    return this.showAddressed || item.status.kind !== 'addressed';
  }

  /** How many addressed notes the dock is hiding. */
  private hiddenCount(): number {
    return this.items.filter((item) => !this.isListed(item)).length;
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
    void this.focusEditor(focus);
  }

  /** Withdraw or Mark Addressed, or back to staged when every note is that already (ADR 0144). */
  private toggleStatus(items: readonly UraItemView[], status: 'withdrawn' | 'addressed'): void {
    const change = noteStatusChange(items, status);
    if (change !== undefined) {
      this.emit('beuve-ura-edit-many', change);
    }
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
    if (title === '' && field('body').trim() === '' && item.suggestedPatch === undefined) {
      form.querySelector('input')?.focus();
      return;
    }
    this.emit('beuve-ura-update', {
      itemId: item.id,
      title,
      body: field('body'),
      severity: this.editingSeverity,
      blocking: this.editingBlocking,
    });
    this.closeEditor();
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
    const resolved = resolveDockVerdict(chosen, this.derivedVerdict, this.blockingCount());
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

  private renderItem(item: UraItemView, index: number): TemplateResult {
    const labels = describeUraItem(item);
    const isDone = item.status.kind !== 'staged';
    const status = statusText(item);
    const isSelected = this.selection.selected.includes(item.id);
    const classes = [
      index === this.cursor && 'cursor',
      isSelected && 'selected',
      isDone && 'done',
      this.draggedIds.includes(item.id) && 'dragging',
      this.dropTarget?.id === item.id && `drop-${this.dropTarget.side}`,
    ].filter((name) => name !== false);
    return html`<li
      class=${classes.join(' ')}
      data-action="item"
      data-item-id=${item.id}
      aria-selected=${isSelected ? 'true' : 'false'}
      draggable=${isDone || this.editingId === item.id ? 'false' : 'true'}
    >
      <div class="meta">
        ${createUraNoteIcon()}
        <span class="severity ${item.severity} ${item.blocking ? 'blocking' : ''}"
          >${labels.emoji} ${labels.severity}</span
        >
        <span class="anchor" title=${labels.anchor}><bdi>${pathText(labels.anchor)}</bdi></span>
        ${
          labels.outdated === undefined
            ? nothing
            : html`<span
                class="outdated"
                title="Written against ${item.headSha.slice(0, 12)}; it is still exported, with its original lines"
                >${labels.outdated}</span
              >`
        }
        ${
          item.posted === undefined
            ? nothing
            : html`<span
                class="posted"
                title="Posted to GitHub ${item.posted.placement === 'inline' ? 'inline' : 'in the review body'}, ${item.posted.postedAt}"
                >posted</span
              >`
        }
        ${
          item.suggestedPatch === undefined
            ? nothing
            : html`<span class="suggestion" title="Carries a suggested change">patch</span>`
        }
        <span class="origin ${item.origin.kind}">${status === '' ? labels.origin : status}</span>
      </div>
      <div class="title">
        ${parseInlineTitle(headlineOfUraItem(item)).map((span) => renderInlineSpan(span))}
      </div>
      ${
        item.suggestedPatch !== undefined && (index === this.cursor || this.editingId === item.id)
          ? html`<beuve-patch-preview .patch=${item.suggestedPatch}></beuve-patch-preview>`
          : nothing
      }
      ${this.editingId === item.id ? this.renderEditor(item) : nothing}
    </li>`;
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
      ${this.renderSuggestionActions(item)}
      <div class="row">
        <beuve-note-expand
          .anchor=${item.anchor}
          .headSha=${item.headSha}
          .noteKey=${item.id}
        ></beuve-note-expand>
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

  /**
   * Re-edit or remove a suggestion. Editing happens in the diff stream (Suggest Edit there), so it is
   * offered only for line notes current on the head they were written against.
   */
  private renderSuggestionActions(item: UraItemView): TemplateResult | typeof nothing {
    const isEditable =
      item.status.kind === 'staged' &&
      item.anchor.kind === 'lines' &&
      item.placement.kind === 'current';
    if (!isEditable && item.suggestedPatch === undefined) {
      return nothing;
    }
    return html`<div class="suggestion-actions">
      ${
        isEditable
          ? html`<button
              class="button"
              type="button"
              data-action="edit-suggestion"
              data-item-id=${item.id}
            >
              ${item.suggestedPatch === undefined ? 'Suggest a change…' : 'Edit suggestion…'}
            </button>`
          : nothing
      }
      ${
        item.suggestedPatch === undefined
          ? nothing
          : html`<button
              class="button"
              type="button"
              data-action="remove-suggestion"
              data-item-id=${item.id}
            >
              Remove suggestion
            </button>`
      }
    </div>`;
  }

  private renderExport(stagedCount: number): TemplateResult {
    const verdict = resolveDockVerdict(
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
    const targets: DockExportTarget[] = [];
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

  private renderExportButton(target: DockExportTarget): TemplateResult {
    const { label, title } = dockExports[target];
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
                <beuve-patch-preview .patch=${edit.diff}></beuve-patch-preview>
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
              class="button primary"
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
  private renderGithub(github: GithubDockState): TemplateResult {
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

  private renderPostActions(github: GithubDockState): TemplateResult {
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

  /** The line that says how many addressed notes are hidden, with a button that lists them. */
  private renderHidden(listedCount: number): TemplateResult | typeof nothing {
    const hidden = this.hiddenCount();
    if (hidden === 0) {
      return nothing;
    }
    let lead = '';
    if (listedCount === 0) {
      lead = 'Every note is addressed. ';
    }
    return html`<p class="empty hidden-notes">
      ${lead}${countNoun(hidden, 'addressed note')} hidden.
      <button type="button" class="button link" data-action="show-addressed">Show</button>
    </p>`;
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
   * Runs a Review ▸ Note command, or Open in Editor: Show, Edit and Open in Editor on the note
   * under the cursor, the others on every selected note (ADR 0144).
   */
  runCommand(id: CommandId): boolean {
    const ordered = this.ordered();
    const current = ordered[this.cursor];
    const targets = this.targetItems();
    switch (id) {
      case 'dock-move':
      case 'dock-extend-selection':
      case 'dock-clear-selection': {
        return true;
      }
      case 'dock-select-all': {
        this.select({ kind: 'all' });
        return true;
      }
      case 'dock-move-up': {
        this.move(targets, -1);
        return true;
      }
      case 'dock-move-down': {
        this.move(targets, 1);
        return true;
      }
      case 'dock-show': {
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
      case 'dock-edit': {
        if (current !== undefined) {
          this.toggleEditor(current);
        }
        return true;
      }
      case 'dock-withdraw': {
        this.toggleStatus(targets, 'withdrawn');
        return true;
      }
      case 'dock-delete': {
        if (targets.length > 0) {
          this.emit('beuve-ura-delete', { itemIds: targets.map((item) => item.id) });
          this.selection = { selected: [], anchor: undefined };
        }
        return true;
      }
      case 'dock-addressed': {
        this.toggleStatus(targets, 'addressed');
        return true;
      }
      case 'dock-blocking': {
        this.toggleBlocking(targets);
        return true;
      }
      case 'dock-change-label': {
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

  /** The notes a Note command acts on: the selected ones in dock order, else the cursor's. */
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

  /** The item under the dock's cursor, which Add to Chat adds by its anchor (ADR 0046). */
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
                      ? 'Nothing staged yet. Choose Review ▸ Add Note on a diff selection, or Stage on a chat answer.'
                      : 'Open a review session to stage notes.'
                  }
                </p>`
              : html`${this.renderSelectionBar()}
                  <ol
                    ?hidden=${ordered.length === 0}
                    aria-label="Staged review items"
                    aria-multiselectable="true"
                    data-action="list"
                  >
                    ${ordered.map((item, index) => this.renderItem(item, index))}
                  </ol>`
          }
          ${this.renderHidden(ordered.length)}
        </section>
        ${this.renderReviewEdits()} ${this.renderExport(stagedCount)}
      </div>
      ${this.emoji.render()}
    `;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('items') || changed.has('showAddressed')) {
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

const inPlaceKeys: Readonly<Record<string, CommandId>> = {
  Enter: 'dock-show',
  ' ': 'dock-edit',
  Delete: 'dock-withdraw',
  Backspace: 'dock-withdraw',
  'Shift+Delete': 'dock-delete',
  'Shift+Backspace': 'dock-delete',
  'Alt+ArrowUp': 'dock-move-up',
  'Alt+ArrowDown': 'dock-move-down',
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
  if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) {
    return;
  }
  event.preventDefault();
  form.requestSubmit();
}

/** Typing in the editor is never a dock shortcut. */
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

/** A key in the open editor (its label menu, its buttons) is the editor's, not the dock's. */
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
function statusText(item: UraItemView): string {
  if (item.status.kind === 'withdrawn' || item.status.kind === 'addressed') {
    return item.status.kind;
  }
  return '';
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-ura-dock': BeuveUraDock;
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
