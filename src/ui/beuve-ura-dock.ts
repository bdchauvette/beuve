import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';

import type {
  UraExportTarget,
  UraItemView,
  UraSeverityView,
  UraVerdictView,
} from '#contract/ipc-contract.ts';

import { describeUraItem } from './describe-ura-item.ts';
import { moveUraItem } from './move-ura-item.ts';
import { resolveDockVerdict } from './resolve-dock-verdict.ts';
import { zoneStyles } from './zone-styles.ts';

/** A status line under the export buttons; `tone` colors it. */
export interface DockNotice {
  readonly tone: 'info' | 'error';
  readonly text: string;
}

const severities: readonly UraSeverityView[] = ['blocker', 'issue', 'question', 'nit', 'praise'];

const verdictLabels: Readonly<Record<UraVerdictView, string>> = {
  approve: 'Approve',
  comment: 'Comment',
  'request-changes': 'Request changes',
};

const exports: readonly { target: UraExportTarget; label: string; title: string }[] = [
  {
    target: 'agent-xml',
    label: 'Copy for Claude Code (XML)',
    title:
      'The review as beuve.ura/1 XML, to paste into Claude Code. Agents can also read it over MCP (beuve_read_human_review).',
  },
  {
    target: 'github',
    label: 'Copy GitHub review (JSON)',
    title: 'The body of POST /repos/{owner}/{repo}/pulls/{number}/reviews.',
  },
  { target: 'markdown', label: 'Copy Markdown', title: 'A numbered summary for anywhere.' },
];

/**
 * Zone 3: the Universal Review Artifact staging dock (ADR 0023, 0027). Lists the session's staged
 * items in export order (severity, `path:lines` on the current head, title, origin, and an
 * outdated marker), then the withdrawn and addressed ones. While the zone has focus: `j`/`k`
 * move, Enter jumps the diff stream to the item, Space opens its editor (title, body, severity),
 * `x` withdraws or restores it, `a` marks it addressed (or restages it), and `Shift+J`/`Shift+K`
 * move it down or up the export order. A verdict selector shows the derived default and refuses
 * approving over a staged blocker; export buttons copy the compiled review. Presentational: emits
 * `beuve-ura-jump`, `beuve-ura-update`, `beuve-ura-transition`, `beuve-ura-reorder` and
 * `beuve-ura-export`; `beuve-app` does the IPC.
 */
@customElement('beuve-ura-dock')
export class BeuveUraDock extends LitElement {
  static override styles = [
    zoneStyles,
    css`
      :host {
        border-left: 1px solid var(--beuve-border);
      }

      .count {
        margin-left: auto;
        font-weight: 400;
        letter-spacing: 0;
        text-transform: none;
      }

      ol {
        display: flex;
        flex-direction: column;
        gap: 2px;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      li {
        padding: var(--beuve-space-1) var(--beuve-space-2);
        border: 1px solid transparent;
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

      li.done .title {
        text-decoration: line-through;
      }

      .meta {
        display: flex;
        align-items: center;
        gap: var(--beuve-space-2);
        min-width: 0;
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      .anchor {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        font: var(--beuve-font-mono);
        font-size: 11px;
        text-overflow: ellipsis;
        white-space: nowrap;
        direction: rtl;
        text-align: left;
      }

      .severity {
        flex: none;
        padding: 0 var(--beuve-space-1);
        border: 1px solid currentcolor;
        border-radius: 4px;
      }

      .severity.blocker {
        color: var(--beuve-danger);
      }

      .severity.issue {
        color: var(--beuve-warn);
      }

      .severity.question {
        color: var(--beuve-accent);
      }

      .severity.nit,
      .severity.praise {
        color: var(--beuve-text-muted);
      }

      .severity.praise {
        color: var(--beuve-ok);
      }

      .origin {
        flex: none;
      }

      .origin.agent-insight {
        color: var(--beuve-insight);
      }

      .origin.impact-finding {
        color: var(--beuve-warn);
      }

      .outdated {
        flex: none;
        color: var(--beuve-warn);
      }

      .title {
        margin-top: 1px;
        overflow-wrap: anywhere;
      }

      .editor {
        display: grid;
        gap: var(--beuve-space-1);
        margin-top: var(--beuve-space-1);
        cursor: default;
      }

      input,
      textarea,
      select {
        box-sizing: border-box;
        min-width: 0;
        padding: var(--beuve-space-1) var(--beuve-space-2);
        border: 1px solid var(--beuve-border);
        border-radius: 4px;
        background: var(--beuve-bg);
        color: var(--beuve-text);
        font: inherit;
      }

      textarea {
        min-height: 72px;
        resize: vertical;
        font: var(--beuve-font-mono);
      }

      input:focus,
      textarea:focus,
      select:focus {
        border-color: var(--beuve-accent);
        outline: none;
      }

      .row {
        display: flex;
        align-items: center;
        gap: var(--beuve-space-2);
      }

      .spacer {
        flex: 1;
      }

      button {
        padding: var(--beuve-space-1) var(--beuve-space-2);
        border: 1px solid var(--beuve-border);
        border-radius: 4px;
        background: var(--beuve-surface);
        color: var(--beuve-text);
        font: var(--beuve-font-small);
        text-align: left;
        cursor: pointer;
      }

      button:hover:not(:disabled) {
        border-color: var(--beuve-accent);
      }

      button:disabled {
        color: var(--beuve-text-muted);
        cursor: default;
      }

      button.primary {
        border-color: var(--beuve-accent);
        background: var(--beuve-accent);
        color: #fff;
      }

      .exports {
        display: grid;
        gap: var(--beuve-space-1);
        margin-top: var(--beuve-space-2);
      }

      .verdict {
        display: flex;
        align-items: center;
        gap: var(--beuve-space-2);
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

      .keys {
        margin: var(--beuve-space-2) 0 0;
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      .keys b {
        font: var(--beuve-font-mono);
        font-size: 11px;
        font-weight: 400;
        color: var(--beuve-text);
      }
    `,
  ];

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) {
      return;
    }
    if (isTextEntry(event)) {
      this.editorKey(event);
      return;
    }
    const ordered = this.ordered();
    const current = ordered[this.cursor];
    const key = event.shiftKey ? event.key.toUpperCase() : event.key;
    switch (key) {
      case 'j':
      case 'k':
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        const step = key === 'j' || key === 'ArrowDown' ? 1 : -1;
        this.cursor = Math.min(Math.max(0, this.cursor + step), Math.max(0, ordered.length - 1));
        this.editingId = undefined;
        void this.revealCursor();
        return;
      }
      case 'J':
      case 'K': {
        event.preventDefault();
        if (current !== undefined) {
          this.move(current, key === 'J' ? 1 : -1);
        }
        return;
      }
      case 'Enter': {
        event.preventDefault();
        if (current !== undefined) {
          this.emit('beuve-ura-jump', { item: current });
        }
        return;
      }
      case ' ': {
        event.preventDefault();
        if (current !== undefined) {
          this.toggleEditor(current);
        }
        return;
      }
      case 'x': {
        event.preventDefault();
        if (current !== undefined) {
          this.transition(current, current.status.kind === 'withdrawn' ? 'staged' : 'withdrawn');
        }
        return;
      }
      case 'a': {
        event.preventDefault();
        if (current !== undefined) {
          this.transition(current, current.status.kind === 'addressed' ? 'staged' : 'addressed');
        }
        return;
      }
      default: {
        return;
      }
    }
  };

  @property({ type: Boolean, reflect: true }) accessor focused = false;
  /** Whether a review session is open; without one there is nothing to stage into. */
  @property({ type: Boolean }) accessor hasSession = false;
  /** The open session's items in dock order, every status (`ura:list`). */
  @property({ attribute: false }) accessor items: readonly UraItemView[] = [];
  @property() accessor derivedVerdict: UraVerdictView = 'approve';
  @property({ attribute: false }) accessor notice: DockNotice | undefined;
  /** Set by the owner while an export is being compiled and copied. */
  @property({ type: Boolean }) accessor exporting = false;

  @state() accessor cursor = 0;
  @state() accessor editingId: string | undefined;
  @state() accessor chosenVerdict: UraVerdictView | undefined;
  @state() accessor verdictRefusal = '';

  constructor() {
    super();
    this.addEventListener('keydown', this.onKeyDown);
  }

  /** Staged items first, in export order, then withdrawn and addressed ones. */
  private ordered(): UraItemView[] {
    return [
      ...this.items.filter((item) => item.status.kind === 'staged'),
      ...this.items.filter((item) => item.status.kind !== 'staged'),
    ];
  }

  private emit(name: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private move(item: UraItemView, step: 1 | -1): void {
    const staged = new Set(
      this.items.filter((entry) => entry.status.kind === 'staged').map((entry) => entry.id),
    );
    const order = this.items.map((entry) => entry.id);
    const moved = moveUraItem(order, item.id, step, staged);
    if (moved.every((id, index) => id === order[index])) {
      return;
    }
    this.cursor = Math.min(Math.max(0, this.cursor + step), staged.size - 1);
    this.emit('beuve-ura-reorder', { itemIds: moved });
  }

  private transition(item: UraItemView, to: 'staged' | 'withdrawn' | 'addressed'): void {
    this.emit('beuve-ura-transition', { itemId: item.id, to });
  }

  private toggleEditor(item: UraItemView): void {
    this.editingId = this.editingId === item.id ? undefined : item.id;
    if (this.editingId !== undefined) {
      void this.focusEditor();
    }
  }

  private async focusEditor(): Promise<void> {
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLInputElement>(':scope .editor input')?.focus();
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
      return typeof value === 'string' ? value : '';
    };
    const title = field('title').trim();
    if (title === '') {
      form.querySelector('input')?.focus();
      return;
    }
    this.emit('beuve-ura-update', {
      itemId: item.id,
      title,
      body: field('body'),
      severity: field('severity') || item.severity,
    });
    this.closeEditor();
  }

  private async revealCursor(): Promise<void> {
    await this.updateComplete;
    this.renderRoot.querySelector('li.cursor')?.scrollIntoView({ block: 'nearest' });
  }

  private chooseVerdict(value: string): void {
    const chosen = value === '' ? undefined : (value as UraVerdictView);
    const resolved = resolveDockVerdict(chosen, this.derivedVerdict, this.blockers());
    this.chosenVerdict = resolved.refusal === undefined ? chosen : undefined;
    this.verdictRefusal = resolved.refusal ?? '';
  }

  private blockers(): number {
    return this.items.filter((item) => item.status.kind === 'staged' && item.severity === 'blocker')
      .length;
  }

  private exportTo(target: UraExportTarget): void {
    const verdict = resolveDockVerdict(this.chosenVerdict, this.derivedVerdict, this.blockers());
    this.emit('beuve-ura-export', {
      target,
      ...(verdict.source === 'chosen' && { verdict: verdict.value }),
    });
  }

  private renderItem(item: UraItemView, index: number): TemplateResult {
    const labels = describeUraItem(item);
    const isDone = item.status.kind !== 'staged';
    const status =
      item.status.kind === 'withdrawn'
        ? 'withdrawn'
        : item.status.kind === 'addressed'
          ? 'addressed'
          : '';
    return html`<li
      class="${index === this.cursor ? 'cursor' : ''} ${isDone ? 'done' : ''}"
      data-item-id=${item.id}
      @click=${(): void => {
        this.cursor = index;
      }}
      @dblclick=${(): void => {
        this.emit('beuve-ura-jump', { item });
      }}
    >
      <div class="meta">
        <span class="severity ${item.severity}">${labels.severity}</span>
        <span class="anchor" title=${labels.anchor}><bdi>${labels.anchor}</bdi></span>
        ${
          labels.outdated === undefined
            ? nothing
            : html`<span
                class="outdated"
                title="Written against ${item.headSha.slice(0, 12)}; it is still exported, with its original lines"
                >${labels.outdated}</span
              >`
        }
        <span class="origin ${item.origin.kind}">${status === '' ? labels.origin : status}</span>
      </div>
      <div class="title">${item.title}</div>
      ${this.editingId === item.id ? this.renderEditor(item) : nothing}
    </li>`;
  }

  private renderEditor(item: UraItemView): TemplateResult {
    const onSubmit = (event: SubmitEvent): void => {
      event.preventDefault();
      this.saveEditor(item, event.target as HTMLFormElement);
    };
    return html`<form
      class="editor"
      @submit=${onSubmit}
      @keydown=${submitOnModEnter}
      @click=${(event: Event): void => {
        event.stopPropagation();
      }}
    >
      <div class="row">
        <select name="severity" aria-label="Severity">
          ${severities.map(
            (severity) =>
              html`<option value=${severity} ?selected=${severity === item.severity}>
                ${severity}
              </option>`,
          )}
        </select>
        <input name="title" aria-label="Title" maxlength="200" .value=${item.title} />
      </div>
      <textarea name="body" aria-label="Body" .value=${item.body}></textarea>
      <div class="row">
        <span class="note">⌘Enter saves · Esc closes</span>
        <span class="spacer"></span>
        <button
          type="button"
          @click=${(): void => {
            this.closeEditor();
          }}
        >
          Cancel
        </button>
        <button type="submit" class="primary">Save</button>
      </div>
    </form>`;
  }

  private renderExport(stagedCount: number): TemplateResult {
    const verdict = resolveDockVerdict(this.chosenVerdict, this.derivedVerdict, this.blockers());
    return html`<section>
      <h2>Export</h2>
      <label class="verdict">
        <span>Verdict</span>
        <select
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
            .map(
              (value) =>
                html`<option value=${value} ?selected=${this.chosenVerdict === value}>
                  ${verdictLabels[value]}
                </option>`,
            )}
        </select>
      </label>
      ${
        this.verdictRefusal === ''
          ? nothing
          : html`<p class="note error" role="alert">${this.verdictRefusal}</p>`
      }
      <div class="exports">
        ${exports.map(
          (entry) =>
            html`<button
              type="button"
              title=${entry.title}
              ?disabled=${!this.hasSession || this.exporting}
              @click=${(): void => {
                this.exportTo(entry.target);
              }}
            >
              ${entry.label}
            </button>`,
        )}
      </div>
      ${
        this.notice === undefined
          ? nothing
          : html`<p class="note ${this.notice.tone}" role="status">${this.notice.text}</p>`
      }
      <p class="note">
        ${stagedCount === 0 ? 'Nothing staged: an export carries only the verdict. ' : ''}Posting to
        GitHub needs sign-in, which beuve doesn't have yet: copy the JSON instead. Agents read the
        same review over MCP (<code>beuve_read_human_review</code>).
      </p>
    </section>`;
  }

  override render(): TemplateResult {
    const ordered = this.ordered();
    const stagedCount = this.items.filter((item) => item.status.kind === 'staged').length;
    return html`
      <header>
        Review dock
        ${this.items.length === 0 ? nothing : html`<span class="count">${stagedCount} staged</span>`}
      </header>
      <div class="body">
        <section>
          ${
            ordered.length === 0
              ? html`<p class="empty">
                  ${
                    this.hasSession
                      ? html`Nothing staged. <kbd>m</kbd> in the diff stream stages the focused hunk
                          or selected lines; <kbd>y</kbd> promotes an agent insight.`
                      : 'Open a review session to stage notes.'
                  }
                </p>`
              : html`<ol aria-label="Staged review items">
                  ${ordered.map((item, index) => this.renderItem(item, index))}
                </ol>`
          }
          ${
            ordered.length === 0
              ? nothing
              : html`<p class="keys">
                  <b>j k</b> move · <b>⏎</b> show · <b>Space</b> edit · <b>x</b> withdraw ·
                  <b>a</b> addressed · <b>⇧J ⇧K</b> reorder
                </p>`
          }
        </section>
        ${this.renderExport(stagedCount)}
      </div>
    `;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('items')) {
      this.cursor = Math.min(this.cursor, Math.max(0, this.items.length - 1));
      if (this.items.every((item) => item.id !== this.editingId)) {
        this.editingId = undefined;
      }
    }
    if (
      (changed.has('items') || changed.has('derivedVerdict')) &&
      this.chosenVerdict === 'approve' &&
      this.blockers() > 0
    ) {
      this.chooseVerdict('approve');
    }
  }
}

/** ⌘/Ctrl+Enter in the editor saves, as Enter in its title does. */
function submitOnModEnter(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) {
    return;
  }
  event.preventDefault();
  (event.currentTarget as HTMLFormElement).requestSubmit();
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

declare global {
  interface HTMLElementTagNameMap {
    'beuve-ura-dock': BeuveUraDock;
  }
}
