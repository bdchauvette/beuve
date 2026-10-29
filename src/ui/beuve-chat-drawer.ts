import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type { ChatCitationView, ChatMentionView, ChatMessageView } from '#contract/ipc-contract.ts';

import type { DraftPart, DraftState } from './chat-draft.ts';
import type { ChatCitation, ChatEntry, ReviewChatEntry } from './chat-entry.ts';
import { describeChatPlaceholder } from './describe-chat-placeholder.ts';
import { describeCitation } from './describe-citation.ts';
import { describeMention } from './describe-mention.ts';
import { insertDraftMention } from './insert-draft-mention.ts';
import { planTranscriptCompaction } from './plan-transcript-compaction.ts';
import { removeDraftMention } from './remove-draft-mention.ts';
import { serializeChatDraft } from './serialize-chat-draft.ts';
import { toDraftParts } from './to-draft-parts.ts';
import { describeReviewSummary } from './describe-review-summary.ts';
import { parseAnswerMarkdown } from './parse-answer-markdown.ts';
import type { AnswerBlock, AnswerSpan } from './parse-answer-markdown.ts';
import { zoneStyles } from './zone-styles.ts';

/** Questions carry at most this many mentions (ADR 0046); main refuses more. */
const maxMentions = 8;

/**
 * Zone 4: the read-only chat drawer. Plain text is a question about the change (ADR 0031); the
 * commands `/review`, `/compact`, `/clear` and `/help` (ADR 0022, 0047) share the input. The
 * input is a one-line editable box that also holds context chips (ADR 0046): `addMention` puts
 * one at the caret; it is atomic (Backspace removes it whole; ←/→ select it and Enter shows its
 * lines). The box's DOM is a projection of a {@link DraftPart} model, read back with
 * `textContent` only, never `innerHTML`. The transcript shows the questions with their chips, the
 * answers (streamed live, then rendered as a safe Markdown subset with a pill for each citation),
 * `/compact` summaries with everything before the latest folded under a divider, and the
 * commands' results. Nothing typed here can change the worktree. Presentational: emits
 * `beuve-chat-submit { text, mentions }`, `beuve-chat-escape`, `beuve-chat-cycle` (Tab),
 * `beuve-chat-cancel`, `beuve-chat-cancel-compaction`, `beuve-chat-stage`, `beuve-chat-cite`,
 * `beuve-chat-mention` (a chip), `beuve-citation` (an insight) and `beuve-open-editor` (`o` on a
 * pill); `beuve-app` parses commands and does the IPC. Focusing the drawer focuses its input; the
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

      .answer.streaming {
        border-left-color: var(--beuve-accent);
      }

      .answer .text > :first-child {
        margin-top: 0;
      }

      .answer p,
      .answer ul {
        margin: var(--beuve-space-1) 0 0;
      }

      .answer ul {
        padding-left: var(--beuve-space-4);
      }

      .answer code,
      .answer pre {
        font: var(--beuve-font-mono);
      }

      .answer code {
        padding: 0 2px;
        border-radius: 3px;
        background: var(--beuve-surface-sunken);
      }

      .answer pre {
        margin: var(--beuve-space-1) 0 0;
        padding: var(--beuve-space-1) var(--beuve-space-2);
        overflow-x: auto;
        border-radius: 4px;
        background: var(--beuve-surface-sunken);
      }

      .marker {
        color: var(--beuve-text-muted);
        opacity: 0.55;
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

      .run {
        padding: var(--beuve-space-1) var(--beuve-space-2);
        border-left: 3px solid var(--beuve-insight);
        background: color-mix(in srgb, var(--beuve-insight) 5%, transparent);
      }

      .run .label {
        font-weight: 600;
        color: var(--beuve-insight);
      }

      .muted {
        color: var(--beuve-text-muted);
      }

      .pills {
        display: flex;
        flex-wrap: wrap;
        gap: var(--beuve-space-1);
        margin-top: var(--beuve-space-1);
      }

      .pill {
        max-width: 320px;
        overflow: hidden;
        padding: 0 var(--beuve-space-2);
        border: 1px solid color-mix(in srgb, var(--beuve-insight) 45%, transparent);
        border-radius: 999px;
        background: var(--beuve-surface);
        color: var(--beuve-text);
        font: var(--beuve-font-small);
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: pointer;
      }

      .pill.dismissed {
        opacity: 0.55;
      }

      .pill .where {
        font: var(--beuve-font-mono);
        font-size: 11px;
        color: var(--beuve-insight);
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

      .summary p,
      .summary ul {
        margin: var(--beuve-space-1) 0 0;
      }

      .summary .text > :first-child {
        margin-top: 0;
      }

      .summary ul {
        padding-left: var(--beuve-space-4);
      }

      .summary code {
        font: var(--beuve-font-mono);
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
      case 'Tab': {
        // The shell ignores keys typed in inputs, and the browser would move focus to the body.
        event.preventDefault();
        event.stopPropagation();
        this.emit('beuve-chat-cycle', { step: event.shiftKey ? -1 : 1 });
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
    if (event.key === 'o') {
      const { path, line } = target.dataset;
      if (path !== undefined && line !== undefined) {
        event.preventDefault();
        this.emit('beuve-open-editor', { path, line: Number(line) });
      }
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

  /** Each chip node's mention; chips are rebuilt from the model, never parsed from markup. */
  private readonly chipMentions = new WeakMap<Node, ChatMentionView>();
  /** The caret when the box last had it, so a chip added from elsewhere lands there. */
  private savedCaret: number | undefined;
  private selectedChip: HTMLElement | undefined;

  @property({ type: Boolean, reflect: true }) accessor focused = false;
  @property({ attribute: false }) accessor transcript: readonly ChatEntry[] = [];
  /** Whether a session is open, for the hint. */
  @property({ type: Boolean }) accessor hasSession = false;
  /** Head-side paths of the reviewed diff; a citation to any other file is marked as outside it. */
  @property({ attribute: false }) accessor diffPaths: ReadonlySet<string> = new Set();
  /** Ids of answers already staged in the review dock. */
  @property({ attribute: false }) accessor stagedMessageIds: ReadonlySet<string> = new Set();

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
          entry.message.status === 'streaming') ||
        (entry.kind === 'compaction' && entry.status === 'running'),
    );
  }

  private cite(citation: ChatCitation): () => void {
    return (): void => {
      this.dispatchEvent(
        new CustomEvent('beuve-citation', {
          detail: { insightId: citation.insightId },
          bubbles: true,
          composed: true,
        }),
      );
    };
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
      case 'review': {
        return this.renderReview(entry);
      }
      case 'message': {
        return this.renderMessage(entry.message);
      }
      case 'compaction': {
        return entry.status === 'running'
          ? html`<div class="entry status" role="status">
              <span>Compacting the conversation…</span>
              <button
                type="button"
                class="action"
                data-nav
                title="Stop compacting; nothing is stored"
                @click=${(): void => {
                  this.emit('beuve-chat-cancel-compaction');
                }}
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
        aria-expanded=${this.showsCompacted ? 'true' : 'false'}
        title=${
          this.showsCompacted
            ? 'Fold the messages the summary replaced'
            : 'Show the messages the summary replaced; questions no longer send them'
        }
        @click=${(): void => {
          this.showsCompacted = !this.showsCompacted;
        }}
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

  private renderMessage(message: ChatMessageView): TemplateResult {
    if (message.role === 'summary') {
      return this.renderSummary(message);
    }
    if (message.role !== 'assistant') {
      // No whitespace around the parts: the question is shown pre-wrapped.
      const parts = toDraftParts(message.content, message.mentions).map((part) =>
        part.kind === 'text' ? part.text : this.renderChip(part.mention),
      );
      return html`<p class="entry you">${parts}</p>`;
    }
    const isStreaming = message.status === 'streaming';
    const blocks = parseAnswerMarkdown(
      message.content,
      message.citations,
      isStreaming ? 'streaming' : 'final',
    );
    return html`<div class="entry answer ${message.status}" role="group" aria-label="Answer">
      ${
        blocks.length === 0
          ? nothing
          : html`<div class="text">${blocks.map((block) => this.renderBlock(block))}</div>`
      }
      ${this.renderMessageStatus(message)}
    </div>`;
  }

  private renderMessageStatus(message: ChatMessageView): TemplateResult {
    switch (message.status) {
      case 'streaming': {
        return html`<div class="status" role="status">
          <span>${message.content === '' ? 'Asking Claude Code…' : 'Answering…'}</span>
          <button
            type="button"
            class="action"
            data-nav
            title="Stop this answer"
            @click=${(): void => {
              this.emit('beuve-chat-cancel', { messageId: message.id });
            }}
          >
            Cancel
          </button>
        </div>`;
      }
      case 'failed': {
        return html`<div class="status error" role="alert">
          ${message.errorMessage ?? 'The question was not answered.'}
        </div>`;
      }
      case 'cancelled': {
        return html`<div class="status">Stopped.</div>`;
      }
      case 'complete': {
        if (message.content.trim() === '') {
          return html``;
        }
        const isStaged = this.stagedMessageIds.has(message.id);
        return html`<div class="status">
          <button
            type="button"
            class="action"
            data-nav
            aria-disabled=${isStaged ? 'true' : 'false'}
            title="Stage this answer as a question in the review dock"
            @click=${(): void => {
              this.emit('beuve-chat-stage', { messageId: message.id });
            }}
          >
            ${isStaged ? 'Staged in the dock' : 'Stage as URA comment'}
          </button>
        </div>`;
      }
    }
  }

  private renderSummary(message: ChatMessageView): TemplateResult {
    const blocks = parseAnswerMarkdown(message.content, message.citations, 'final');
    return html`<div class="entry summary" role="group" aria-label="Conversation summary">
      <div
        class="label"
        title="/compact wrote it; later questions send it instead of the turns above"
      >
        Conversation summary
      </div>
      <div class="text">${blocks.map((block) => this.renderBlock(block))}</div>
    </div>`;
  }

  private renderChip(mention: ChatMentionView): TemplateResult {
    const { label, title } = describeMention(mention);
    return html`<button
      type="button"
      class="chip"
      data-nav
      data-side=${mention.side}
      title="${title} (show it)"
      @click=${(): void => {
        this.emit('beuve-chat-mention', { mention });
      }}
    >
      ${label}
    </button>`;
  }

  private renderBlock(block: AnswerBlock): TemplateResult {
    switch (block.kind) {
      case 'paragraph': {
        return html`<p>${block.spans.map((span) => this.renderSpan(span))}</p>`;
      }
      case 'list': {
        return html`<ul>
          ${block.items.map((item) => html`<li>${item.map((span) => this.renderSpan(span))}</li>`)}
        </ul>`;
      }
      case 'code': {
        return html`<pre>${block.text}</pre>`;
      }
    }
  }

  private renderSpan(span: AnswerSpan): TemplateResult | string {
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
      case 'marker': {
        return html`<span class="marker">${span.text}</span>`;
      }
      case 'citation': {
        return this.renderPill(span.citation);
      }
    }
  }

  private renderPill(citation: ChatCitationView): TemplateResult {
    const { label, title } = describeCitation(citation);
    const isOutside = !this.diffPaths.has(citation.path);
    return html`<button
      type="button"
      class="cite ${isOutside ? 'outside' : ''}"
      data-nav
      data-path=${citation.path}
      data-line=${citation.startLine}
      title=${isOutside ? `${title} (not in this diff)` : `${title} (show in the diff)`}
      @click=${(): void => {
        this.emit('beuve-chat-cite', { citation });
      }}
    >
      ${label}
    </button>`;
  }

  private renderReview(entry: ReviewChatEntry): TemplateResult {
    return html`<div class="entry run" role="status">
      <span class="label">Preliminary review</span>
      ${this.renderReviewState(entry)}
      ${
        entry.citations.length === 0
          ? nothing
          : html`<div class="pills">
              ${entry.citations.map(
                (citation) =>
                  html`<button
                    type="button"
                    class="pill ${citation.status}"
                    data-path=${citation.path}
                    data-line=${citation.line}
                    title="${citation.severity}: ${citation.title} (jump to it)"
                    @click=${this.cite(citation)}
                  >
                    <span class="where">${shortPath(citation.path)}:${citation.line}</span>
                    ${citation.title}
                  </button>`,
              )}
            </div>`
      }
    </div>`;
  }

  private renderReviewState(entry: ReviewChatEntry): TemplateResult {
    switch (entry.status) {
      case 'requesting': {
        return html`<span class="muted">· starting…</span>`;
      }
      case 'running': {
        const joined = entry.joined === 'attached' ? 'already running; following it. ' : '';
        return html`<span class="muted">· ${joined}${entry.progress ?? 'started'}…</span>`;
      }
      case 'completed': {
        const { summary } = entry;
        if (summary === undefined) {
          return html``;
        }
        const scope =
          summary.pathPrefixes === undefined ? '' : ` under ${summary.pathPrefixes.join(', ')}`;
        const files =
          summary.fileCount === undefined
            ? ''
            : ` · ${String(summary.fileCount)} ${summary.fileCount === 1 ? 'file' : 'files'}${scope}`;
        const joined =
          entry.joined === undefined
            ? nothing
            : html`<span class="muted"
                >${
                  entry.joined === 'reused'
                    ? `· Stored result for ${summary.headSha.slice(0, 8)}; /review --fresh reruns it.`
                    : '· Joined the run already in flight.'
                }</span
              >`;
        return html`<span>· ${describeReviewSummary(summary)}</span>
          <span class="muted">· ${summary.model}${files}${duration(summary.durationMs)}</span>
          ${joined}`;
      }
      case 'failed': {
        return html`<span class="failed">· ${entry.error?.message ?? 'failed'}</span>`;
      }
    }
  }

  /** Types `text` into the input for the reviewer to finish (the palette's commands with arguments). */
  prefill(text: string): void {
    this.setDraft(text, []);
  }

  /** Replaces the input with a question and its chips, caret at the end (a refused question). */
  setDraft(text: string, mentions: readonly ChatMentionView[]): void {
    void this.updateComplete.then(() => {
      const parts = toDraftParts(text, mentions);
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
    return html`
      <div class="body" @keydown=${this.onBodyKeyDown}>
        ${
          this.transcript.length === 0
            ? html`<p class="empty">
                ${
                  this.hasSession
                    ? 'Ask a question about this change, or type /review for a preliminary review.'
                    : 'Open a review session, then ask a question about it.'
                }
                Claude Code only runs when you ask, with your own login: the question, the diff and
                the files it reads leave this machine. It never edits anything. /help lists the
                commands. <kbd>Esc</kbd> returns to the diff.
              </p>`
            : html`<div class="transcript" aria-live="polite">${this.renderTranscript()}</div>`
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
    if (summaryOf(changed.get('transcript')) !== summaryOf(this.transcript)) {
      this.showsCompacted = false;
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    const body = this.renderRoot.querySelector('.body');
    if (body !== null && changed.has('transcript')) {
      body.scrollTop = body.scrollHeight;
    }
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

/** The id of the summary the transcript folds at, to unfold afresh when it changes. */
function summaryOf(entries: readonly ChatEntry[] | undefined): string | undefined {
  const { boundary } = planTranscriptCompaction(entries ?? []);
  return entries?.[boundary]?.id.toString();
}

function shortPath(path: string): string {
  return path.split('/').at(-1) ?? path;
}

function duration(ms: number | undefined): string {
  return ms === undefined || ms === 0 ? '' : ` · ${(ms / 1000).toFixed(1)} s`;
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-chat-drawer': BeuveChatDrawer;
  }
}
