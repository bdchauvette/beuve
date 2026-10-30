import { css, html, LitElement, nothing, render } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type {
  ChatCitationView,
  ChatFindingView,
  ChatMentionView,
  ChatMessageView,
  ChatPartView,
  ChatReviewView,
} from '#contract/ipc-contract.ts';

import './beuve-sheet-code.ts';
import type { DraftPart, DraftState } from './chat-draft.ts';
import type { ChatEntry, MessageChatEntry } from './chat-entry.ts';
import { describeChatPlaceholder } from './describe-chat-placeholder.ts';
import { describeChatReview } from './describe-chat-review.ts';
import type { FindingLabels } from './describe-chat-review.ts';
import { citationMarker } from './citation-marker.ts';
import type { MarkdownRenderers } from './create-markdown-nodes.ts';
import { describeCitation } from './describe-citation.ts';
import { describeMention } from './describe-mention.ts';
import { insertDraftMention } from './insert-draft-mention.ts';
import { planTranscriptCompaction } from './plan-transcript-compaction.ts';
import { removeDraftMention } from './remove-draft-mention.ts';
import { serializeChatDraft } from './serialize-chat-draft.ts';
import { chatTextFrom } from './chat-text-from.ts';
import { draftPartsFrom } from './draft-parts-from.ts';
import { isActiveRequest } from './is-active-request.ts';
import { MarkdownView } from './markdown-view.ts';
import { planMessageParts } from './plan-message-parts.ts';
import type { MessageBlock, StepPart } from './plan-message-parts.ts';
import type { MarkdownBlock } from './markdown-tree.ts';
import { snippetPathFrom } from './snippet-path-from.ts';
import { textPartStream } from './text-part-stream.ts';
import type { ChatStreamSubscribe } from './text-part-stream.ts';
import { zoneStyles } from './zone-styles.ts';

/** Questions carry at most this many mentions (ADR 0046); main refuses more. */
const maxMentions = 8;

/**
 * Zone 4: the read-only chat drawer. Plain text is a question about the change (ADR 0031); the
 * commands `/review`, `/summarize`, `/compact`, `/clear` and `/help` (ADR 0047, 0055, 0056) share
 * the input. What is sent while an answer runs waits its turn in main's queue and shows as
 * "queued" until it starts (ADR 0057); a line under the transcript offers to clear the queue. The
 * input is a one-line editable box that also holds context chips (ADR 0046): `addMention` puts
 * one at the caret; it is atomic (Backspace removes it whole; ←/→ select it and Enter shows its
 * lines). The box's DOM is a projection of a {@link DraftPart} model, read back with
 * `textContent` only, never `innerHTML`. The transcript shows the questions with their chips, the
 * answers (Markdown rendered as it streams, ADR 0073, with a pill for each validated citation),
 * `/review` answers as a list of findings (severity, category, confidence, whether a second pass
 * confirmed it, a pill and a Stage button each), `/summarize` answers as a calm block, `/compact`
 * summaries with everything before the latest folded under a divider, and the commands' results. Nothing typed here can change the worktree. Presentational: emits
 * `beuve-chat-submit { text, mentions }`, `beuve-chat-escape`,
 * `beuve-chat-cancel`, `beuve-chat-cancel-compaction`, `beuve-chat-clear-queue`,
 * `beuve-chat-stage`, `beuve-chat-stage-finding`, `beuve-chat-cite`, `beuve-chat-mention` (a chip)
 * and `beuve-open-editor` (Open in Editor on a pill); `beuve-app` parses commands and does the IPC. Focusing the drawer focuses its input; the
 * arrow keys move between the transcript's buttons (pills, chips, Cancel, Stage) and the input.
 */
@customElement('beuve-chat-drawer')
export class BeuveChatDrawer extends LitElement {
  static override styles = [
    zoneStyles,
    css`
      :host {
        border-top: 1px solid var(--beuve-border);
      }

      .transcript {
        display: flex;
        flex-direction: column;
        gap: var(--beuve-space-2);
      }

      .entry {
        margin: 0;
        line-height: 1.45;
      }

      .input-echo {
        font: var(--beuve-font-mono);
        color: var(--beuve-text-muted);
      }

      .input-echo::before {
        content: '› ';
      }

      .note p {
        margin: 0;
      }

      .note.error,
      .failed {
        color: var(--beuve-danger);
      }

      .you {
        margin: 0;
        font: var(--beuve-font-mono);
        color: var(--beuve-text-muted);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      .you::before {
        content: '› ';
      }

      .answer {
        padding: var(--beuve-space-1) 0 var(--beuve-space-1) var(--beuve-space-3);
        border-left: 2px solid var(--beuve-border);
        overflow-wrap: anywhere;
      }

      .answer.streaming,
      .answer.submitted {
        border-left-color: var(--beuve-accent);
      }

      .text > :first-child {
        margin-top: 0;
      }

      .text :is(p, ul, ol, blockquote, pre, hr, .table, .code-block) {
        margin: var(--beuve-space-1) 0 0;
      }

      .text :is(h1, h2, h3, h4, h5, h6) {
        margin: var(--beuve-space-2) 0 0;
        font-size: 1em;
        font-weight: 600;
        line-height: 1.3;
      }

      .text h1 {
        font-size: 1.15em;
      }

      .text h2 {
        font-size: 1.08em;
      }

      .text :is(ul, ol) {
        padding-left: var(--beuve-space-4);
      }

      .text li > :is(p, ul, ol):first-child,
      .text li > :is(ul, ol) {
        margin-top: 0;
      }

      .text blockquote {
        margin-left: 0;
        padding-left: var(--beuve-space-2);
        border-left: 2px solid var(--beuve-border);
        color: var(--beuve-text-muted);
      }

      .text hr {
        border: none;
        border-top: 1px solid var(--beuve-border);
      }

      .text a {
        color: var(--beuve-accent);
        text-decoration: underline;
        text-underline-offset: 2px;
        cursor: pointer;
      }

      .text code,
      .text pre {
        font: var(--beuve-font-mono);
      }

      .text code {
        padding: 0 2px;
        border-radius: 3px;
        background: var(--beuve-surface-sunken);
      }

      .text pre,
      .text .code-block {
        overflow-x: auto;
        border-radius: 4px;
        background: var(--beuve-code-bg, var(--beuve-surface-sunken));
      }

      .text pre {
        padding: var(--beuve-space-1) var(--beuve-space-2);
        color: var(--beuve-code-text, inherit);
        white-space: pre;
      }

      .text .code-block {
        border: 1px solid var(--beuve-border);
      }

      .text .table {
        overflow-x: auto;
      }

      .text table {
        border-collapse: collapse;
        font: inherit;
      }

      .text :is(th, td) {
        padding: 2px var(--beuve-space-2);
        border: 1px solid var(--beuve-border);
        text-align: start;
        vertical-align: top;
      }

      .text th {
        background: var(--beuve-surface-sunken);
        font-weight: 600;
      }

      .text .align-center {
        text-align: center;
      }

      .text .align-right {
        text-align: end;
      }

      .marker {
        color: var(--beuve-text-muted);
        opacity: 0.55;
      }

      .steps {
        margin: 0 0 var(--beuve-space-1);
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      .steps summary {
        cursor: pointer;
      }

      .steps-list {
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .step {
        display: flex;
        gap: var(--beuve-space-1);
        align-items: baseline;
        min-width: 0;
      }

      .step-name {
        overflow: hidden;
        font: var(--beuve-font-mono);
        font-size: 11px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .step.reasoning .step-name {
        font: var(--beuve-font-small);
        font-style: italic;
      }

      .step.running .step-mark {
        color: var(--beuve-accent);
      }

      .step.failed .step-mark {
        color: var(--beuve-danger);
      }

      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }

      .status {
        display: flex;
        align-items: center;
        gap: var(--beuve-space-2);
        margin-top: var(--beuve-space-1);
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      .status.error {
        color: var(--beuve-danger);
      }

      button.cite {
        padding: 0 var(--beuve-space-2);
        border: 1px solid color-mix(in srgb, var(--beuve-accent) 40%, transparent);
        border-radius: 999px;
        background: var(--beuve-accent-soft);
        color: var(--beuve-accent);
        font: var(--beuve-font-mono);
        font-size: 11px;
        cursor: pointer;
      }

      button.cite.outside {
        border-style: dashed;
        background: transparent;
        color: var(--beuve-text-muted);
      }

      button.action {
        padding: 0 var(--beuve-space-2);
        border: 1px solid var(--beuve-border);
        border-radius: 4px;
        background: var(--beuve-surface);
        color: var(--beuve-text);
        font: var(--beuve-font-small);
        cursor: pointer;
      }

      button.action[aria-disabled='true'] {
        color: var(--beuve-text-muted);
        cursor: default;
      }

      button.cite:hover,
      button.action:hover:not([aria-disabled='true']) {
        border-color: var(--beuve-accent);
      }

      button.cite:focus-visible,
      button.action:focus-visible {
        outline: 2px solid var(--beuve-accent);
        outline-offset: 1px;
      }

      .muted {
        color: var(--beuve-text-muted);
      }

      .you .queued {
        margin-left: var(--beuve-space-2);
        font: var(--beuve-font-small);
        white-space: nowrap;
      }

      .you .queued button.action {
        margin-left: var(--beuve-space-1);
        font-size: 10px;
      }

      .review-head,
      .abstract .label {
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      .findings {
        display: flex;
        flex-direction: column;
        gap: var(--beuve-space-2);
        margin: var(--beuve-space-2) 0 0;
        padding: 0;
        list-style: none;
      }

      .finding {
        padding-top: var(--beuve-space-2);
        border-top: 1px solid var(--beuve-border);
      }

      .finding.revealed {
        margin: 0 calc(-1 * var(--beuve-space-2));
        padding: var(--beuve-space-1) var(--beuve-space-2);
        border-radius: var(--beuve-radius);
        background: var(--beuve-accent-soft);
      }

      .finding:first-child {
        padding-top: 0;
        border-top: none;
      }

      .finding-head {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--beuve-space-2);
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      .severity {
        font-weight: 600;
      }

      .severity.risk {
        color: var(--beuve-danger);
      }

      .severity.warning {
        color: var(--beuve-warn);
      }

      .check.confirmed {
        color: var(--beuve-ok);
      }

      .finding-title {
        margin-top: 2px;
        font-weight: 600;
      }

      .finding-title .text > p {
        margin: 0;
      }

      .finding .text :is(p, ul, ol) {
        margin: 2px 0 0;
      }

      .finding .status {
        margin-top: var(--beuve-space-1);
      }

      .abstract {
        padding: var(--beuve-space-2) var(--beuve-space-3);
        border: 1px solid var(--beuve-border);
        border-radius: var(--beuve-radius);
        background: var(--beuve-surface);
        overflow-wrap: anywhere;
      }

      .abstract .label {
        margin-bottom: var(--beuve-space-1);
      }

      .queue {
        display: flex;
        align-items: center;
        gap: var(--beuve-space-2);
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      form {
        display: flex;
        gap: var(--beuve-space-2);
        flex: none;
        padding: var(--beuve-space-2) var(--beuve-space-3);
        border-top: 1px solid var(--beuve-border);
      }

      .editor {
        flex: 1;
        min-width: 0;
        max-height: 8.5em;
        overflow-y: auto;
        padding: var(--beuve-space-1) var(--beuve-space-2);
        border: 1px solid var(--beuve-border);
        border-radius: var(--beuve-radius);
        background: var(--beuve-bg);
        color: var(--beuve-text);
        font: var(--beuve-font-mono);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        cursor: text;
      }

      .editor:focus {
        border-color: var(--beuve-accent);
        outline: none;
      }

      .editor[data-empty]::before {
        content: attr(data-placeholder);
        color: var(--beuve-text-muted);
        pointer-events: none;
      }

      .chip {
        display: inline-block;
        max-width: calc(100% - 4px);
        overflow: hidden;
        margin: 0 1px;
        padding: 0 5px;
        border: 1px solid color-mix(in srgb, var(--beuve-accent) 30%, transparent);
        border-radius: 4px;
        background: var(--beuve-accent-soft);
        color: var(--beuve-accent);
        font: var(--beuve-font-mono);
        font-size: 11px;
        line-height: 16px;
        text-overflow: ellipsis;
        white-space: nowrap;
        vertical-align: text-bottom;
        cursor: pointer;
        user-select: none;
      }

      .chip[data-side='base'] {
        border-style: dashed;
        border-color: var(--beuve-border);
        background: var(--beuve-surface-sunken);
        color: var(--beuve-text-muted);
      }

      .chip[data-selected],
      button.chip:focus-visible {
        outline: 2px solid var(--beuve-accent);
        outline-offset: 0;
      }

      button.chip {
        font: var(--beuve-font-mono);
        font-size: 11px;
        line-height: 16px;
      }

      .summary {
        padding: var(--beuve-space-2) var(--beuve-space-3);
        border: 1px solid var(--beuve-border);
        border-radius: var(--beuve-radius);
        background: var(--beuve-surface-sunken);
        overflow-wrap: anywhere;
      }

      .summary .label {
        margin-bottom: var(--beuve-space-1);
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      button.divider {
        display: flex;
        align-items: center;
        gap: var(--beuve-space-2);
        width: 100%;
        padding: 0;
        border: none;
        background: none;
        color: var(--beuve-text-muted);
        font: var(--beuve-font-small);
        cursor: pointer;
      }

      button.divider::before,
      button.divider::after {
        content: '';
        flex: 1;
        border-top: 1px solid var(--beuve-border);
      }

      button.divider:hover,
      button.divider:focus-visible {
        color: var(--beuve-text);
        outline: none;
      }

      .compacted {
        display: flex;
        flex-direction: column;
        gap: var(--beuve-space-2);
        opacity: 0.72;
      }
    `,
  ];

  private readonly onEditorKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) {
      return;
    }
    const chip = this.selectedChip;
    if (chip !== undefined && !chipKeys.has(event.key)) {
      this.selectChip(undefined);
    }
    switch (event.key) {
      case 'Enter': {
        event.preventDefault();
        if (chip === undefined) {
          this.submit();
        } else {
          this.showChip(chip);
        }
        return;
      }
      case 'Backspace':
      case 'Delete': {
        this.removeChip(event, chip);
        return;
      }
      case 'ArrowLeft':
      case 'ArrowRight': {
        this.stepOverChip(event, chip);
        return;
      }
      case 'Escape': {
        event.preventDefault();
        event.stopPropagation();
        if (chip !== undefined) {
          this.selectChip(undefined);
          return;
        }
        this.emit('beuve-chat-escape');
        return;
      }
      case 'ArrowUp': {
        const buttons = this.navButtons();
        if (buttons.length > 0) {
          event.preventDefault();
          buttons.at(-1)?.focus();
        }
        return;
      }
      default: {
        return;
      }
    }
  };

  /** Arrow keys walk the transcript's buttons; the end of the list leads back to the input. */
  private readonly onBodyKeyDown = (event: KeyboardEvent): void => {
    const { target } = event;
    if (event.ctrlKey || event.metaKey || event.altKey || !(target instanceof HTMLButtonElement)) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.emit('beuve-chat-escape');
      return;
    }
    const step = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[event.key];
    if (step === undefined) {
      return;
    }
    event.preventDefault();
    const buttons = this.navButtons();
    const next = buttons[buttons.indexOf(target) + step];
    if (next === undefined) {
      this.focus();
    } else {
      next.focus();
    }
  };

  private readonly onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    this.submit();
  };

  /** Typing changes the text runs only; the chips stay the nodes they were. */
  private readonly onEditorInput = (): void => {
    const editor = this.editorElement();
    if (editor?.textContent === '' && editor.childNodes.length > 0) {
      editor.replaceChildren();
    }
    this.rememberCaret();
    this.syncEmpty();
  };

  private readonly onEditorClick = (event: MouseEvent): void => {
    const chip = event.target instanceof Element ? event.target.closest('.chip') : undefined;
    if (chip instanceof HTMLElement) {
      event.preventDefault();
      this.showChip(chip);
      return;
    }
    this.selectChip(undefined);
    this.rememberCaret();
  };

  private readonly onEditorCaret = (): void => {
    this.rememberCaret();
  };

  /**
   * Every button of the transcript, through one listener (event delegation): a button says what
   * it does in `data-action` and what it acts on in `data-*`, read back from the transcript.
   */
  private readonly onTranscriptClick = (event: MouseEvent): void => {
    const button =
      event.target instanceof Element
        ? (event.target.closest<HTMLElement>('[data-action]') ?? undefined)
        : undefined;
    if (button === undefined) {
      return;
    }
    const {
      action,
      messageId = '',
      partId,
      finding,
      path = '',
      start,
      end,
      url = '',
    } = button.dataset;
    switch (action) {
      case 'link': {
        // A link in an answer never navigates the window; main opens what it allows (ADR 0040).
        event.preventDefault();
        this.emit('beuve-open-link', { url });
        return;
      }
      case 'cancel': {
        this.emit('beuve-chat-cancel', { messageId });
        return;
      }
      case 'cancel-compaction': {
        this.emit('beuve-chat-cancel-compaction');
        return;
      }
      case 'clear-queue': {
        this.emit('beuve-chat-clear-queue');
        return;
      }
      case 'toggle-compacted': {
        this.showsCompacted = !this.showsCompacted;
        return;
      }
      case 'stage': {
        this.emit('beuve-chat-stage', { messageId });
        return;
      }
      case 'stage-finding': {
        this.emit('beuve-chat-stage-finding', { messageId, finding: Number(finding) });
        return;
      }
      case 'cite': {
        const citation = { path, startLine: Number(start), endLine: Number(end) };
        this.emit('beuve-chat-cite', { citation });
        return;
      }
      case 'mention': {
        const mention = this.mentionOf(messageId, partId);
        if (mention !== undefined) {
          this.emit('beuve-chat-mention', { mention });
        }
        return;
      }
      default: {
        return;
      }
    }
  };

  /** Each chip node's mention; chips are rebuilt from the model, never parsed from markup. */
  private readonly chipMentions = new WeakMap<Node, ChatMentionView>();
  /** The caret when the box last had it, so a chip added from elsewhere lands there. */
  private savedCaret: number | undefined;
  private selectedChip: HTMLElement | undefined;
  /** Questions whose answers wait in the queue, to those answers' ids; kept with the transcript. */
  private queued: ReadonlyMap<string, string> = new Map();
  /**
   * The transcript's rendered Markdown by key (ADR 0073), kept across renders so that streamed
   * blocks and highlighted code stay as they are; views a render no longer uses are dropped.
   */
  private readonly markdownViews = new Map<string, MarkdownEntry>();
  private renderedMarkdown = new Set<string>();

  @property({ type: Boolean, reflect: true }) accessor focused = false;
  @property({ attribute: false }) accessor transcript: readonly ChatEntry[] = [];
  /** Whether a session is open, for the hint. */
  @property({ type: Boolean }) accessor hasSession = false;
  /** Head-side paths of the reviewed diff; a citation to any other file is marked as outside it. */
  @property({ attribute: false }) accessor diffPaths: ReadonlySet<string> = new Set();
  /** `chat:stream` (ADR 0072), from which a running answer's text parts stream; absent, they re-render. */
  @property({ attribute: false }) accessor subscribeChatStream: ChatStreamSubscribe | undefined;
  /** Ids of answers already staged in the review dock. */
  @property({ attribute: false }) accessor stagedMessageIds: ReadonlySet<string> = new Set();
  /** `/review` findings already staged, as `messageId:index`. */
  @property({ attribute: false }) accessor stagedFindings: ReadonlySet<string> = new Set();

  @state() accessor isDraftEmpty = true;
  /** Whether the messages a summary replaced are unfolded. */
  @state() accessor showsCompacted = false;

  private editorElement(): HTMLElement | undefined {
    return this.renderRoot.querySelector<HTMLElement>('.editor') ?? undefined;
  }

  /** The editable box's selection; Chromium keeps one per shadow root. */
  private selection(): Selection | null {
    const root = this.renderRoot as ShadowRoot & { getSelection?: () => Selection | null };
    return root.getSelection?.() ?? document.getSelection();
  }

  /** The box's content as the model, read from its nodes. */
  private readParts(): DraftPart[] {
    const parts: DraftPart[] = [];
    const nodes = this.editorElement()?.childNodes ?? [];
    for (const node of nodes) {
      const mention = this.chipMentions.get(node);
      const text = node.nodeName === 'BR' ? '' : (node.textContent ?? '');
      if (mention !== undefined) {
        parts.push({ kind: 'mention', mention });
      } else if (text !== '') {
        const last = parts.at(-1);
        if (last?.kind === 'text') {
          parts[parts.length - 1] = { kind: 'text', text: last.text + text };
        } else {
          parts.push({ kind: 'text', text });
        }
      }
    }
    return parts;
  }

  /** Renders the model into the box and puts the caret at its position. */
  private renderDraft(draft: DraftState): void {
    const editor = this.editorElement();
    if (editor === undefined) {
      return;
    }
    this.selectChip(undefined);
    editor.replaceChildren(
      ...draft.parts.map((part) =>
        part.kind === 'text' ? document.createTextNode(part.text) : this.chipNode(part.mention),
      ),
    );
    this.syncEmpty();
    if (this.shadowRoot?.activeElement === editor) {
      this.placeCaret(draft.caret);
    }
    this.savedCaret = draft.caret;
  }

  private chipNode(mention: ChatMentionView): HTMLElement {
    const { label, title } = describeMention(mention);
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.contentEditable = 'false';
    chip.dataset['side'] = mention.side;
    chip.textContent = label;
    chip.title = `${title}. Click to show it; Backspace removes it.`;
    this.chipMentions.set(chip, mention);
    return chip;
  }

  /** The caret as a model position, or `undefined` when the selection is outside the box. */
  private caretOffset(): number | undefined {
    const editor = this.editorElement();
    const selection = this.selection();
    if (editor === undefined || selection === null || selection.rangeCount === 0) {
      return undefined;
    }
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer)) {
      return undefined;
    }
    let position = 0;
    for (const [index, child] of [...editor.childNodes].entries()) {
      if (range.startContainer === editor && index === range.startOffset) {
        return position;
      }
      if (child === range.startContainer || child.contains(range.startContainer)) {
        return (
          position +
          (child.nodeType === Node.TEXT_NODE ? range.startOffset : range.startOffset > 0 ? 1 : 0)
        );
      }
      position += this.nodeLength(child);
    }
    return position;
  }

  private nodeLength(node: Node): number {
    if (this.chipMentions.has(node)) {
      return 1;
    }
    return node.nodeName === 'BR' ? 0 : (node.textContent ?? '').length;
  }

  private placeCaret(caret: number): void {
    const editor = this.editorElement();
    const selection = this.selection();
    if (editor === undefined || selection === null) {
      return;
    }
    const range = document.createRange();
    let position = 0;
    let isPlaced = false;
    for (const [index, child] of [...editor.childNodes].entries()) {
      const length = this.nodeLength(child);
      if (child.nodeType === Node.TEXT_NODE && caret <= position + length) {
        range.setStart(child, caret - position);
        isPlaced = true;
        break;
      }
      if (child.nodeType !== Node.TEXT_NODE && caret <= position) {
        range.setStart(editor, index);
        isPlaced = true;
        break;
      }
      position += length;
    }
    if (!isPlaced) {
      range.setStart(editor, editor.childNodes.length);
    }
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  private rememberCaret(): void {
    this.savedCaret = this.caretOffset() ?? this.savedCaret;
  }

  private syncEmpty(): void {
    this.isDraftEmpty = this.readParts().every(
      (part) => part.kind === 'text' && part.text.trim() === '',
    );
  }

  /** The chip node just before (`-1`) or after (`1`) a collapsed caret, if there is one. */
  private chipBeside(step: -1 | 1): HTMLElement | undefined {
    const caret = this.caretOffset();
    const selection = this.selection();
    const editor = this.editorElement();
    if (caret === undefined || editor === undefined || selection?.isCollapsed !== true) {
      return undefined;
    }
    const target = step === -1 ? caret - 1 : caret;
    let position = 0;
    for (const child of editor.childNodes) {
      const length = this.nodeLength(child);
      if (target >= position && target < position + length) {
        return this.chipMentions.has(child) && child instanceof HTMLElement ? child : undefined;
      }
      position += length;
    }
    return undefined;
  }

  private selectChip(chip: HTMLElement | undefined): void {
    this.selectedChip?.removeAttribute('data-selected');
    this.selectedChip = chip;
    chip?.setAttribute('data-selected', '');
  }

  /** ←/→ beside a chip selects it; again moves past it. */
  private stepOverChip(event: KeyboardEvent, chip: HTMLElement | undefined): void {
    const step = event.key === 'ArrowLeft' ? -1 : 1;
    const editor = this.editorElement();
    if (chip !== undefined && editor !== undefined) {
      event.preventDefault();
      const index = [...editor.childNodes].indexOf(chip);
      const before = [...editor.childNodes]
        .slice(0, index)
        .reduce((sum, node) => sum + this.nodeLength(node), 0);
      this.selectChip(undefined);
      this.placeCaret(step === -1 ? before : before + 1);
      this.rememberCaret();
      return;
    }
    const beside = this.chipBeside(step);
    if (beside === undefined) {
      return;
    }
    event.preventDefault();
    this.selectChip(beside);
  }

  /** Backspace or Delete next to a chip, or on a selected one, removes it whole. */
  private removeChip(event: KeyboardEvent, chip: HTMLElement | undefined): void {
    const parts = this.readParts();
    const caret = this.caretOffset() ?? 0;
    const direction = event.key === 'Backspace' ? 'backward' : 'forward';
    let next: DraftState | undefined;
    if (chip === undefined) {
      next =
        this.selection()?.isCollapsed === true
          ? removeDraftMention({ parts, caret }, direction)
          : undefined;
    } else {
      const editor = this.editorElement();
      const index = editor === undefined ? -1 : [...editor.childNodes].indexOf(chip);
      const position = [...(editor?.childNodes ?? [])]
        .slice(0, Math.max(0, index))
        .reduce((sum, node) => sum + this.nodeLength(node), 0);
      next = removeDraftMention({ parts, caret: position }, 'forward');
    }
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    this.renderDraft(next);
    this.placeCaret(next.caret);
  }

  private showChip(chip: Element): void {
    const mention = this.chipMentions.get(chip);
    if (mention !== undefined) {
      this.emit('beuve-chat-mention', { mention });
    }
  }

  private submit(): void {
    const { text, mentions } = serializeChatDraft(this.readParts());
    this.renderDraft({ parts: [], caret: 0 });
    this.savedCaret = undefined;
    this.emit('beuve-chat-submit', { text, mentions });
  }

  private navButtons(): HTMLButtonElement[] {
    return [...this.renderRoot.querySelectorAll<HTMLButtonElement>('button[data-nav]')];
  }

  private emit(name: string, detail?: object): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private isAnswering(): boolean {
    return this.transcript.some(
      (entry) =>
        (entry.kind === 'message' &&
          entry.message.role === 'assistant' &&
          (entry.message.status === 'queued' || isActiveRequest(entry.message))) ||
        (entry.kind === 'compaction' && entry.status === 'running'),
    );
  }

  /** Questions whose answer still waits in the queue, to the answer's id. */
  private queuedQuestions(): ReadonlyMap<string, string> {
    const queued = new Map<string, string>();
    for (const [index, entry] of this.transcript.entries()) {
      const next = this.transcript[index + 1];
      if (
        entry.kind === 'message' &&
        entry.message.role === 'user' &&
        next?.kind === 'message' &&
        next.message.status === 'queued'
      ) {
        queued.set(entry.id, next.id);
      }
    }
    return queued;
  }

  /** The mention part `partId` of message `messageId` in the transcript. */
  private mentionOf(messageId: string, partId: string | undefined): ChatMentionView | undefined {
    const entry = this.transcript.find(
      (candidate): candidate is MessageChatEntry =>
        candidate.kind === 'message' && candidate.id === messageId,
    );
    const part = entry?.message.parts.find((candidate) => candidate.id === partId);
    return part?.kind === 'mention' ? part.mention : undefined;
  }

  private renderEntry(entry: ChatEntry): TemplateResult {
    switch (entry.kind) {
      case 'input': {
        return html`<p class="entry input-echo">${entry.text}</p>`;
      }
      case 'note': {
        return html`<div class="entry note ${entry.tone}">
          ${entry.lines.map((line) => html`<p>${line}</p>`)}
        </div>`;
      }
      case 'message': {
        return this.renderMessage(entry);
      }
      case 'compaction': {
        return entry.status === 'running'
          ? html`<div class="entry status" role="status">
              <span>Compacting the conversation…</span>
              <button
                type="button"
                class="action"
                data-nav
                data-action="cancel-compaction"
                title="Stop compacting; nothing is stored"
              >
                Cancel
              </button>
            </div>`
          : html`<div class="entry note error">
              <p>${entry.message ?? 'Compaction failed.'}</p>
            </div>`;
      }
    }
  }

  /** The transcript, with everything before the latest summary folded under a divider. */
  private renderTranscript(): TemplateResult {
    const { boundary, compactedMessages } = planTranscriptCompaction(this.transcript);
    if (boundary === -1) {
      return html`${this.transcript.map((entry) => this.renderEntry(entry))}`;
    }
    const earlier = this.transcript.slice(0, boundary);
    const later = this.transcript.slice(boundary);
    const count = `${String(compactedMessages)} ${compactedMessages === 1 ? 'message' : 'messages'}`;
    return html`
      <button
        type="button"
        class="divider"
        data-nav
        data-action="toggle-compacted"
        aria-expanded=${this.showsCompacted ? 'true' : 'false'}
        title=${
          this.showsCompacted
            ? 'Fold the messages the summary replaced'
            : 'Show the messages the summary replaced; questions no longer send them'
        }
      >
        Compacted · ${count} ${this.showsCompacted ? '▾' : '▸'}
      </button>
      ${
        this.showsCompacted
          ? html`<div class="compacted">${earlier.map((entry) => this.renderEntry(entry))}</div>`
          : nothing
      }
      ${later.map((entry) => this.renderEntry(entry))}
    `;
  }

  private renderMessage(entry: MessageChatEntry): TemplateResult {
    const { message } = entry;
    if (message.role === 'summary') {
      return this.renderSummary(message);
    }
    if (message.role !== 'assistant') {
      // No whitespace around the parts: the question is shown pre-wrapped.
      const parts = message.parts.map((part) =>
        part.kind === 'mention' ? this.renderChip(message.id, part.id, part.mention) : textOf(part),
      );
      const answerId = this.queued.get(message.id);
      const shown = answerId === undefined ? parts : [...parts, this.renderQueuedTag(answerId)];
      return html`<p class="entry you">${shown}</p>`;
    }
    if (message.status === 'queued') {
      // Its question says it waits; the answer appears when it starts.
      return html``;
    }
    if (message.status === 'done' && message.review !== undefined) {
      return this.renderReviewAnswer(message, message.review);
    }
    if (message.answerKind === 'abstract' && message.status === 'done') {
      return this.renderAbstract(message);
    }
    const isActive = isActiveRequest(message);
    return html`<div
      class="entry answer ${message.status}"
      role="group"
      aria-label="Answer"
      aria-busy=${isActive ? 'true' : 'false'}
      data-message-id=${message.id}
    >
      ${planMessageParts(message.parts).map((block) => this.renderBlockOf(message, block))}
      ${this.renderMessageStatus(message, entry.activity)}
    </div>`;
  }

  /** One block of an answer: a run of steps, text as safe Markdown, a finding or an error. */
  private renderBlockOf(message: ChatMessageView, block: MessageBlock): TemplateResult {
    if (block.kind === 'steps') {
      return this.renderSteps(block, isActiveRequest(message));
    }
    const { part } = block;
    switch (part.kind) {
      case 'text': {
        const live = isActiveRequest(message)
          ? { messageId: message.id, partId: part.id }
          : undefined;
        return html`${this.markdownFor(`${message.id}:${part.id}`, part.text, message.citations, live)}`;
      }
      case 'error': {
        return html`<div class="status error" role="alert">${part.message}</div>`;
      }
      case 'finding':
      case 'mention': {
        return html``;
      }
    }
  }

  /**
   * What the model did, in order: open while the request runs, then folded into its one-line
   * label. Tool descriptions say what was looked at, never what was found.
   */
  private renderSteps(
    block: Extract<MessageBlock, { kind: 'steps' }>,
    isOpen: boolean,
  ): TemplateResult {
    const items = html`<ul class="steps-list">
      ${block.parts.map((part) =>
        part.kind === 'tool-call'
          ? html`<li class="step ${part.state}" data-part-id=${part.id}>
              <span class="step-mark" aria-hidden="true">${stepMarks[part.state]}</span>
              <span class="step-name">${part.description}</span>
              <span class="visually-hidden">${stepStates[part.state]}</span>
            </li>`
          : html`<li class="step reasoning ${part.state}" data-part-id=${part.id}>
              <span class="step-mark" aria-hidden="true">${stepMarks[part.state]}</span>
              <span class="step-name"
                >${part.state === 'running' ? 'Thinking' : 'Thought'}${
                  part.summary === undefined ? '' : `: ${part.summary}`
                }</span
              >
            </li>`,
      )}
    </ul>`;
    return isOpen
      ? html`<div class="steps">${items}</div>`
      : html`<details class="steps">
          <summary>${block.label}</summary>
          ${items}
        </details>`;
  }

  private renderMessageStatus(message: ChatMessageView, activity?: string): TemplateResult {
    switch (message.status) {
      case 'queued':
      case 'error': {
        return html``;
      }
      case 'submitted':
      case 'streaming': {
        const hasText = message.parts.some((part) => part.kind === 'text' && part.text !== '');
        return html`<div class="status" role="status">
          <span>${activity ?? (hasText ? 'Answering…' : startedLabel(message))}</span>
          <button
            type="button"
            class="action"
            data-nav
            data-action="cancel"
            data-message-id=${message.id}
            title="Stop this answer"
          >
            Cancel
          </button>
        </div>`;
      }
      case 'cancelled': {
        return html`<div class="status">
          ${message.parts.length === 0 ? 'Not asked.' : 'Stopped.'}
        </div>`;
      }
      case 'done': {
        return chatTextFrom(message.parts).trim() === ''
          ? html``
          : this.renderStageButton(
              message.id,
              'Stage this answer as a question in the review dock',
            );
      }
    }
  }

  private renderStageButton(messageId: string, title: string): TemplateResult {
    const isStaged = this.stagedMessageIds.has(messageId);
    return html`<div class="status">
      <button
        type="button"
        class="action"
        data-nav
        data-action="stage"
        data-message-id=${messageId}
        aria-disabled=${isStaged ? 'true' : 'false'}
        title=${title}
      >
        ${isStaged ? 'Staged in the dock' : 'Stage as URA comment'}
      </button>
    </div>`;
  }

  private renderSummary(message: ChatMessageView): TemplateResult {
    const text = this.markdownFor(
      `${message.id}:summary`,
      chatTextFrom(message.parts),
      message.citations,
    );
    return html`<div class="entry summary" role="group" aria-label="Conversation summary">
      <div
        class="label"
        title="/compact wrote it; later questions send it instead of the turns above"
      >
        Conversation summary
      </div>
      ${text}
    </div>`;
  }

  private renderChip(messageId: string, partId: string, mention: ChatMentionView): TemplateResult {
    const { label, title } = describeMention(mention);
    return html`<button
      type="button"
      class="chip"
      data-nav
      data-action="mention"
      data-message-id=${messageId}
      data-part-id=${partId}
      data-side=${mention.side}
      title="${title} (show it)"
    >
      ${label}
    </button>`;
  }

  /**
   * The rendered Markdown of `source` under `key` (ADR 0073). The text part of a running request
   * (`live`) streams: its deltas come from `chat:stream` through `textPartStream`, starting from
   * the text it has, so finished blocks render once and only the open tail changes. Anything else,
   * a streamed part once its message ends included, is shown whole through the same parser with
   * a pill for each of `citations`; an unchanged render is skipped.
   */
  private markdownFor(
    key: string,
    source: string,
    citations: readonly ChatCitationView[],
    live?: { readonly messageId: string; readonly partId: string },
  ): HTMLElement {
    this.renderedMarkdown.add(key);
    const entry = this.markdownViews.get(key) ?? this.createMarkdownEntry(key);
    const subscribe = this.subscribeChatStream;
    if (live !== undefined && subscribe !== undefined) {
      if (entry.stream === undefined) {
        const controller = new AbortController();
        entry.stream = controller;
        entry.shown = undefined;
        const text = textPartStream(subscribe, {
          ...live,
          initialText: source,
          signal: controller.signal,
        });
        void entry.view.stream(text, this.markdownRenderers([], 'streaming'), controller.signal);
      }
      return entry.view.element;
    }
    entry.stream?.abort();
    entry.stream = undefined;
    const { shown } = entry;
    if (
      shown?.source !== source ||
      shown.citations !== citations ||
      shown.diffPaths !== this.diffPaths
    ) {
      entry.view.show(
        source,
        this.markdownRenderers(citations, live === undefined ? 'final' : 'streaming'),
      );
      entry.shown = { source, citations, diffPaths: this.diffPaths };
    }
    return entry.view.element;
  }

  private createMarkdownEntry(key: string): MarkdownEntry {
    const element = document.createElement('div');
    element.className = 'text';
    const entry: MarkdownEntry = {
      view: new MarkdownView(element, () => {
        this.scrollToEnd();
      }),
    };
    this.markdownViews.set(key, entry);
    return entry;
  }

  /**
   * How an answer's citations and code render: while it streams every well-formed marker is
   * dimmed, once it is final a marker of `citations` is a pill and any other one is text
   * (ADR 0031). A closed fence is highlighted like a sheet; an open one is plain text.
   */
  private markdownRenderers(
    citations: readonly ChatCitationView[],
    mode: 'final' | 'streaming',
  ): MarkdownRenderers {
    const known = new Map(citations.map((citation) => [citationMarker(citation), citation]));
    return {
      marker: (text): Node => {
        const citation = known.get(text);
        if (mode === 'streaming') {
          return markerNode(text);
        }
        if (citation === undefined) {
          return document.createTextNode(text);
        }
        const pill = document.createDocumentFragment();
        render(this.renderPill(citation), pill);
        return pill;
      },
      code: codeBlockNode,
    };
  }

  private scrollToEnd(): void {
    const body = this.renderRoot.querySelector('.body');
    if (body !== null) {
      body.scrollTop = body.scrollHeight;
    }
  }

  private renderPill(citation: ChatCitationView): TemplateResult {
    const { label, title } = describeCitation(citation);
    const isOutside = !this.diffPaths.has(citation.path);
    return html`<button
      type="button"
      class="cite ${isOutside ? 'outside' : ''}"
      data-nav
      data-action="cite"
      data-path=${citation.path}
      data-line=${citation.startLine}
      data-start=${citation.startLine}
      data-end=${citation.endLine}
      title=${isOutside ? `${title} (not in this diff)` : `${title} (show in the diff)`}
    >
      ${label}
    </button>`;
  }

  /** "queued" after a question that waits its turn, and a small Cancel that takes it out. */
  private renderQueuedTag(answerId: string): TemplateResult {
    return html`<span class="queued muted"
      >queued<button
        type="button"
        class="action"
        data-nav
        data-action="cancel"
        data-message-id=${answerId}
        title="Take it out of the queue"
      >
        Cancel
      </button></span
    >`;
  }

  /**
   * A `/review` answer (ADR 0055): one summary line, then each finding part with its own
   * actions, and what the model did folded above them.
   */
  private renderReviewAnswer(message: ChatMessageView, review: ChatReviewView): TemplateResult {
    const labels = describeChatReview(review);
    const blocks = planMessageParts(message.parts);
    const findings = message.parts.flatMap((part) => (part.kind === 'finding' ? part.finding : []));
    return html`<div class="entry answer done" role="group" aria-label="Review">
      <div class="review-head">Review · ${labels.summary}</div>
      ${blocks.flatMap((block) => (block.kind === 'steps' ? [this.renderSteps(block, false)] : []))}
      ${
        findings.length === 0
          ? html`<p class="muted">
              Nothing worth your attention was found. That is no proof of correctness: the review
              doesn’t build or run the code.
            </p>`
          : html`<ol class="findings">
              ${findings.map((index) => {
                const finding = review.findings[index];
                return finding === undefined
                  ? nothing
                  : this.renderFinding(message.id, index, finding, labels.findings[index]);
              })}
            </ol>`
      }
      ${labels.note === undefined ? nothing : html`<div class="status">${labels.note}</div>`}
    </div>`;
  }

  private renderFinding(
    messageId: string,
    index: number,
    finding: ChatFindingView,
    labels: FindingLabels | undefined,
  ): TemplateResult {
    const citation = {
      path: finding.path,
      startLine: finding.startLine,
      endLine: finding.endLine,
    };
    const key = `${messageId}:${String(index)}`;
    const isStaged = this.stagedFindings.has(key);
    return html`<li class="finding" data-finding=${`${messageId}:${String(index)}`}>
      <div class="finding-head">
        <span class="severity ${finding.severity}">${labels?.severity}</span>
        <span>${labels?.category}</span>
        <span title="The model’s own confidence">${labels?.confidence}</span>
        <span class="check ${finding.check}" title=${labels?.checkTitle ?? ''}>
          ${finding.check === 'confirmed' ? '✓ confirmed' : labels?.check}
        </span>
      </div>
      <div class="finding-title">${this.markdownFor(`${key}:title`, finding.title, [])}</div>
      ${finding.body.trim() === '' ? nothing : this.markdownFor(`${key}:body`, finding.body, [])}
      <div class="status">
        ${this.renderPill(citation)}
        <button
          type="button"
          class="action"
          data-nav
          data-action="stage-finding"
          data-message-id=${messageId}
          data-finding=${index}
          aria-disabled=${isStaged ? 'true' : 'false'}
          title="Stage this finding on its lines in the review dock"
        >
          ${isStaged ? 'Staged' : 'Stage'}
        </button>
      </div>
    </li>`;
  }

  /** A `/summarize` answer (ADR 0056): a calm block, stageable like any answer. */
  private renderAbstract(message: ChatMessageView): TemplateResult {
    const text = this.markdownFor(
      `${message.id}:abstract`,
      chatTextFrom(message.parts),
      message.citations,
    );
    return html`<div class="entry abstract" role="group" aria-label="Summary of the change">
      <div
        class="label"
        title="Written from the diff and the code; the pull request description is not used"
      >
        Summary of the change · from the diff
      </div>
      ${text}
      ${this.renderStageButton(message.id, 'Stage this summary as a comment in the review dock')}
    </div>`;
  }

  private renderQueue(): TemplateResult | typeof nothing {
    const waiting = this.transcript.filter(
      (entry) => entry.kind === 'message' && entry.message.status === 'queued',
    ).length;
    if (waiting === 0) {
      return nothing;
    }
    return html`<div class="queue">
      <span>${waiting === 1 ? '1 waiting' : `${String(waiting)} waiting`}</span>
      <button
        type="button"
        class="action"
        data-nav
        data-action="clear-queue"
        title="Drop the questions still waiting; the running answer goes on (/clear queue)"
      >
        Clear queue
      </button>
    </div>`;
  }

  /** Scrolls to a `/review` finding of the transcript and marks it for a moment (ADR 0061). */
  async revealFinding(messageId: string, finding: number): Promise<void> {
    await this.updateComplete;
    const key = `${messageId}:${String(finding)}`;
    const item = [...this.renderRoot.querySelectorAll<HTMLElement>('[data-finding]')].find(
      (element) => element.dataset['finding'] === key,
    );
    if (item === undefined) {
      return;
    }
    item.scrollIntoView({ block: 'center' });
    item.classList.add('revealed');
    setTimeout(() => {
      item.classList.remove('revealed');
    }, 1800);
  }

  /** Types `text` into the input for the reviewer to finish (the palette's commands with arguments). */
  prefill(text: string): void {
    this.setDraft(text, []);
  }

  /** Replaces the input with a question and its chips, caret at the end (a refused question). */
  setDraft(text: string, mentions: readonly ChatMentionView[]): void {
    void this.updateComplete.then(() => {
      const parts = draftPartsFrom(text, mentions);
      const caret = parts.reduce(
        (sum, part) => sum + (part.kind === 'text' ? part.text.length : 1),
        0,
      );
      this.renderDraft({ parts, caret });
      this.focus();
    });
  }

  /**
   * Puts a context chip at the caret, or at the end when the box never had one (ADR 0046), and
   * focuses the box after it. `duplicate` when the same lines are already attached, `full` at
   * the limit; neither changes the input.
   */
  async addMention(mention: ChatMentionView): Promise<'added' | 'duplicate' | 'full'> {
    await this.updateComplete;
    const parts = this.readParts();
    const mentions = parts.flatMap((part) => (part.kind === 'mention' ? [part.mention] : []));
    const key = (item: ChatMentionView): string =>
      [item.path, item.side, item.startLine ?? '', item.endLine ?? '', item.sha].join('\0');
    if (mentions.some((item) => key(item) === key(mention))) {
      this.focus();
      return 'duplicate';
    }
    if (mentions.length >= maxMentions) {
      this.focus();
      return 'full';
    }
    const length = parts.reduce(
      (sum, part) => sum + (part.kind === 'text' ? part.text.length : 1),
      0,
    );
    const caret = Math.min(this.savedCaret ?? length, length);
    const next = insertDraftMention({ parts, caret }, mention);
    this.renderDraft(next);
    this.focus();
    return 'added';
  }

  /** Focuses the input, with the caret where it was, after the first render if needed. */
  override focus(options?: FocusOptions): void {
    const editor = this.editorElement();
    if (editor === undefined) {
      void this.updateComplete.then(() => {
        this.focus(options);
      });
      return;
    }
    if (this.shadowRoot?.activeElement !== editor) {
      editor.focus(options);
    }
    const length = this.readParts().reduce(
      (sum, part) => sum + (part.kind === 'text' ? part.text.length : 1),
      0,
    );
    if (this.caretOffset() === undefined || this.savedCaret !== undefined) {
      this.placeCaret(Math.min(this.savedCaret ?? length, length));
    }
  }

  override render(): TemplateResult {
    this.renderedMarkdown = new Set();
    return html`
      <div class="body" @keydown=${this.onBodyKeyDown}>
        ${
          this.transcript.length === 0
            ? html`<p class="empty">
                ${
                  this.hasSession
                    ? 'Ask a question about this change, /summarize for beuve’s own summary of it, or /review for findings checked against the code.'
                    : 'Open a review session, then ask a question about it.'
                }
                Claude Code only runs when you ask, with your own login: the question, the diff and
                the files it reads leave this machine. It never edits anything.
              </p>`
            : html`<div class="transcript" aria-live="polite" @click=${this.onTranscriptClick}>
                ${this.renderTranscript()} ${this.renderQueue()}
              </div>`
        }
      </div>
      <form @submit=${this.onSubmit}>
        <div
          class="editor"
          contenteditable="plaintext-only"
          role="textbox"
          aria-label="Ask a question or run a command"
          aria-multiline="false"
          spellcheck="false"
          data-placeholder=${describeChatPlaceholder(this.isAnswering())}
          ?data-empty=${this.isDraftEmpty}
          @keydown=${this.onEditorKeyDown}
          @input=${this.onEditorInput}
          @click=${this.onEditorClick}
          @keyup=${this.onEditorCaret}
          @focusout=${this.onEditorCaret}
        ></div>
      </form>
    `;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has('transcript')) {
      return;
    }
    this.queued = this.queuedQuestions();
    if (summaryOf(changed.get('transcript')) !== summaryOf(this.transcript)) {
      this.showsCompacted = false;
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    for (const [key, entry] of this.markdownViews) {
      if (this.renderedMarkdown.has(key)) {
        continue;
      }

      entry.stream?.abort();
      this.markdownViews.delete(key);
    }
    if (changed.has('transcript')) {
      this.scrollToEnd();
    }
  }

  override disconnectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.disconnectedCallback();
    for (const entry of this.markdownViews.values()) {
      entry.stream?.abort();
    }
    this.markdownViews.clear();
  }
}

/** Keys that act on a selected chip rather than deselecting it. */
const chipKeys: ReadonlySet<string> = new Set([
  'Enter',
  'Backspace',
  'Delete',
  'ArrowLeft',
  'ArrowRight',
  'Escape',
  'Shift',
]);

/** What a step's state looks like, and says to a screen reader. */
const stepMarks: Readonly<Record<StepPart['state'], string>> = {
  running: '…',
  done: '✓',
  failed: '✗',
  stopped: '–',
};

const stepStates: Readonly<Record<StepPart['state'], string>> = {
  running: '(running)',
  done: '(done)',
  failed: '(failed)',
  stopped: '(stopped)',
};

/** A question's text part, or nothing for any other part (questions hold text and mentions). */
function textOf(part: ChatPartView): string {
  return part.kind === 'text' ? part.text : '';
}

/** The id of the summary the transcript folds at, to unfold afresh when it changes. */
function summaryOf(entries: readonly ChatEntry[] | undefined): string | undefined {
  const { boundary } = planTranscriptCompaction(entries ?? []);
  return entries?.[boundary]?.id.toString();
}

/** What a just-started answer says before any text: a review reads the code first. */
function startedLabel(message: ChatMessageView): string {
  switch (message.answerKind) {
    case 'review': {
      return 'Reviewing…';
    }
    case 'abstract': {
      return 'Summarizing the change…';
    }
    default: {
      // Main names the configured model in the status's activity once it has resolved it.
      return 'Asking…';
    }
  }
}

/** A rendered Markdown text of the transcript. */
interface MarkdownEntry {
  readonly view: MarkdownView;
  /** Stops the text part's stream; set while it streams, and after, until the message ends. */
  stream?: AbortController | undefined;
  /** What {@link MarkdownView.show} last rendered, so an unchanged render is skipped. */
  shown?:
    | {
        readonly source: string;
        readonly citations: readonly ChatCitationView[];
        readonly diffPaths: ReadonlySet<string>;
      }
    | undefined;
}

/** A citation marker of an answer still streaming: shown dimmed until it is validated. */
function markerNode(text: string): Node {
  const marker = document.createElement('span');
  marker.className = 'marker';
  marker.textContent = text;
  return marker;
}

/** A fenced block: highlighted once closed (ADR 0025's Alabaster themes), plain while open. */
function codeBlockNode(block: Extract<MarkdownBlock, { kind: 'code' }>): Element {
  if (!block.closed) {
    const pre = document.createElement('pre');
    pre.className = 'open';
    pre.textContent = block.text;
    return pre;
  }
  const code = document.createElement('beuve-sheet-code');
  code.compact = true;
  code.path = snippetPathFrom(block.info);
  code.contents = block.text;
  code.cacheKey = `chat\0${block.text}`;
  const wrapper = document.createElement('div');
  wrapper.className = 'code-block';
  wrapper.append(code);
  return wrapper;
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-chat-drawer': BeuveChatDrawer;
  }
}
