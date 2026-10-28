import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { ChatCitation, ChatEntry, ReviewChatEntry } from './chat-entry.ts';
import { describeReviewSummary } from './describe-review-summary.ts';
import { zoneStyles } from './zone-styles.ts';

/**
 * Zone 4: the read-only chat drawer. For now it takes commands (`/review`, `/help`; ADR 0022)
 * and shows their results in a transcript, with citation pills that jump the diff stream to an
 * insight; Q&A over the worktree grows from the same input later. Nothing typed here can change
 * the worktree. Presentational: emits `beuve-chat-submit`, `beuve-chat-escape` and
 * `beuve-citation`; `beuve-app` parses commands and does the IPC. Focusing the drawer focuses its
 * input.
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
    if (event.key !== 'Escape') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.dispatchEvent(new CustomEvent('beuve-chat-escape', { bubbles: true, composed: true }));
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

  private inputElement(): HTMLInputElement | undefined {
    return this.renderRoot.querySelector('input') ?? undefined;
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
    }
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
      <div class="body">
        ${
          this.transcript.length === 0
            ? html`<p class="empty">
                ${
                  this.hasSession
                    ? 'Type /review to have Claude Code look over this change.'
                    : 'Open a review session, then type /review.'
                }
                It runs only when you ask, with your own Claude Code login: the diff and the files
                it reads leave this machine. /help lists the commands. <kbd>Esc</kbd> returns to the
                diff.
              </p>`
            : html`<div class="transcript" aria-live="polite">
                ${this.transcript.map((entry) => this.renderEntry(entry))}
              </div>`
        }
      </div>
      <form @submit=${this.onSubmit}>
        <input
          type="text"
          aria-label="Chat command"
          placeholder="/review, /help (questions come later)"
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
