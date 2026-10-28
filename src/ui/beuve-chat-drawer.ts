import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { ChatCitationView, ChatMessageView } from '#contract/ipc-contract.ts';

import type { ChatCitation, ChatEntry, ReviewChatEntry } from './chat-entry.ts';
import { describeCitation } from './describe-citation.ts';
import { describeReviewSummary } from './describe-review-summary.ts';
import { parseAnswerMarkdown } from './parse-answer-markdown.ts';
import type { AnswerBlock, AnswerSpan } from './parse-answer-markdown.ts';
import { zoneStyles } from './zone-styles.ts';

/**
 * Zone 4: the read-only chat drawer. Plain text is a question about the change (ADR 0031); the
 * commands `/review`, `/clear` and `/help` (ADR 0022) share the input. The transcript shows the
 * questions, the answers (streamed live, then rendered as a safe Markdown subset with a pill for
 * each citation) and the commands' results. Nothing typed here can change the worktree.
 * Presentational: emits `beuve-chat-submit`, `beuve-chat-escape`, `beuve-chat-cycle` (Tab),
 * `beuve-chat-cancel`, `beuve-chat-stage`, `beuve-chat-cite`, `beuve-citation` (an insight) and `beuve-open-editor` (`o` on a pill);
 * `beuve-app` parses commands and does the IPC. Focusing the drawer focuses its input; the arrow
 * keys move between the transcript's buttons (pills, Cancel, Stage) and the input.
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

      input {
        flex: 1;
        min-width: 0;
        padding: var(--beuve-space-1) var(--beuve-space-2);
        border: 1px solid var(--beuve-border);
        border-radius: var(--beuve-radius);
        background: var(--beuve-bg);
        color: var(--beuve-text);
        font: var(--beuve-font-mono);
      }

      input:focus {
        border-color: var(--beuve-accent);
        outline: none;
      }
    `,
  ];

  private readonly onInputKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    switch (event.key) {
      case 'Escape': {
        event.preventDefault();
        event.stopPropagation();
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
      this.inputElement()?.focus();
    } else {
      next.focus();
    }
  };

  private readonly onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    const input = this.inputElement();
    if (input === undefined) {
      return;
    }
    const text = input.value;
    input.value = '';
    this.dispatchEvent(
      new CustomEvent('beuve-chat-submit', { detail: { text }, bubbles: true, composed: true }),
    );
  };

  @property({ type: Boolean, reflect: true }) accessor focused = false;
  @property({ attribute: false }) accessor transcript: readonly ChatEntry[] = [];
  /** Whether a session is open, for the hint. */
  @property({ type: Boolean }) accessor hasSession = false;
  /** Head-side paths of the reviewed diff; a citation to any other file is marked as outside it. */
  @property({ attribute: false }) accessor diffPaths: ReadonlySet<string> = new Set();
  /** Ids of answers already staged in the review dock. */
  @property({ attribute: false }) accessor stagedMessageIds: ReadonlySet<string> = new Set();

  private inputElement(): HTMLInputElement | undefined {
    return this.renderRoot.querySelector('input') ?? undefined;
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
        entry.kind === 'message' &&
        entry.message.role === 'assistant' &&
        entry.message.status === 'streaming',
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
    }
  }

  private renderMessage(message: ChatMessageView): TemplateResult {
    if (message.role !== 'assistant') {
      return html`<p class="entry you">${message.content}</p>`;
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

  /** Focuses the command input, after the first render if it hasn't happened yet. */
  override focus(options?: FocusOptions): void {
    const input = this.inputElement();
    if (input === undefined) {
      void this.updateComplete.then(() => {
        this.inputElement()?.focus(options);
      });
      return;
    }
    input.focus(options);
  }

  override render(): TemplateResult {
    return html`
      <header>Chat <span>· read-only</span></header>
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
            : html`<div class="transcript" aria-live="polite">
                ${this.transcript.map((entry) => this.renderEntry(entry))}
              </div>`
        }
      </div>
      <form @submit=${this.onSubmit}>
        <input
          type="text"
          aria-label="Ask a question or run a command"
          placeholder=${this.isAnswering() ? 'Answering… ask again when it is done' : 'Ask about this change, or /review, /clear, /help'}
          autocomplete="off"
          spellcheck="false"
          @keydown=${this.onInputKeyDown}
        />
      </form>
    `;
  }

  protected override updated(changed: PropertyValues<this>): void {
    const body = this.renderRoot.querySelector('.body');
    if (body !== null && changed.has('transcript')) {
      body.scrollTop = body.scrollHeight;
    }
  }
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
