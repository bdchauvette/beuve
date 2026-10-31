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

import type { CommandId } from '#contract/command-catalog.ts';

import './beuve-patch-preview.ts';
import { ActionDelegation } from './action-delegation.ts';
import { withPayload } from './with-payload.ts';
import { displayAccelerator } from './display-accelerator.ts';
import { keyPlatformOf } from './key-platform-of.ts';
import { describeReviewPreview } from './describe-review-preview.ts';
import { describeUraItem } from './describe-ura-item.ts';
import type { GithubDockState } from './github-post-state.ts';
import { moveUraItem } from './move-ura-item.ts';
import { parseInlineTitle } from './parse-inline-title.ts';
import type { InlineSpan } from './parse-markdown-subset.ts';
import { resolveDockVerdict } from './resolve-dock-verdict.ts';
import { zoneStyles } from './zone-styles.ts';
import { formatControlStyles } from './format-control-styles.ts';
import { pathText } from './path-text.ts';

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
];

/**
 * Zone 3: the Universal Review Artifact staging dock (ADR 0023, 0027). Lists the session's staged
 * items in export order (severity, `path:lines` on the current head, title, origin, and an
 * outdated marker), then the withdrawn and addressed ones. While the zone has focus: ↑/↓ move,
 * Return jumps the diff stream to the item, Space opens its editor (title, body, severity), Delete
 * withdraws or restores it and ⌥↑/⌥↓ move it up or down the export order; Review ▸ Note and the
 * context menu run the same commands (`runCommand`, ADR 0068), and Open in Editor opens it
 * (`beuve-open-editor`). A verdict selector shows the derived default and refuses
 * approving over a staged blocker; export buttons copy the compiled review. Items carrying a
 * suggested patch say `suggestion` and preview it under the cursor; the editor can re-edit the
 * suggestion in the diff stream or remove it (ADR 0043). Presentational: emits
 * `beuve-ura-edit-suggestion`,
 * `beuve-ura-jump`, `beuve-ura-update`, `beuve-ura-transition`, `beuve-ura-reorder` and
 * `beuve-ura-export`; `beuve-app` does the IPC.
 */
@customElement('beuve-ura-dock')
export class BeuveUraDock extends LitElement {
  static override styles = [
    formatControlStyles,
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

      .title code {
        padding: 0 2px;
        border-radius: 3px;
        background: var(--beuve-surface-sunken);
        font: var(--beuve-font-mono);
      }

      .suggestion {
        flex: none;
        color: var(--beuve-accent);
      }

      beuve-patch-preview {
        margin-top: var(--beuve-space-1);
      }

      .editor .suggestion-actions {
        display: flex;
        align-items: center;
        gap: var(--beuve-space-1);
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

      .github {
        display: grid;
        gap: var(--beuve-space-1);
        margin-top: var(--beuve-space-2);
      }

      .github .note {
        margin: 0;
      }

      .github.confirm {
        padding: var(--beuve-space-2);
        border: 1px solid var(--beuve-accent);
        border-radius: var(--beuve-radius);
        background: var(--beuve-accent-soft);
      }

      .github .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--beuve-space-1);
      }

      button.link {
        display: inline;
        padding: 0;
        border: 0;
        background: none;
        color: var(--beuve-accent);
        text-decoration: underline;
      }

      .posted {
        font: var(--beuve-font-small);
        color: var(--beuve-ok);
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
    `,
  ];

  /** The dock's in-place keys (ADR 0068): ↑/↓ move, Return shows, Space edits, Delete withdraws, ⌥↑/⌥↓ reorder. */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.defaultPrevented) {
      return;
    }
    if (isTextEntry(event)) {
      this.editorKey(event);
      return;
    }
    const step = ({ ArrowDown: 1, ArrowUp: -1 } as const)[event.key];
    if (step !== undefined && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      this.moveCursor(step);
      return;
    }
    const key = event.altKey ? `Alt+${event.key}` : event.key;
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
  @state() accessor editingId: string | undefined;
  @state() accessor verdictRefusal = '';

  /** `process.platform`, for the Save button's tooltip. */
  @property() accessor platform = '';

  constructor() {
    super();
    this.addEventListener('keydown', this.onKeyDown);
    // ADR 0074: the items, their editor and the export buttons, through one listener per type.
    this.addController(
      new ActionDelegation(this, {
        click: {
          item: withPayload(
            ({ itemId }) => this.itemOf(itemId),
            (found): void => {
              this.cursor = this.ordered().indexOf(found);
            },
          ),
          editor: (_data, event): void => {
            event.stopPropagation();
          },
          'cancel-edit': (_data, event): void => {
            event.stopPropagation();
            this.closeEditor();
          },
          'edit-suggestion': withPayload(
            ({ itemId }) => this.itemOf(itemId),
            (found, event): void => {
              event.stopPropagation();
              this.closeEditor();
              this.emit('beuve-ura-edit-suggestion', { itemId: found.id });
            },
          ),
          'remove-suggestion': withPayload(
            ({ itemId }) => this.itemOf(itemId),
            (found, event): void => {
              event.stopPropagation();
              this.emit('beuve-ura-update', { itemId: found.id, suggestedPatch: '' });
            },
          ),
          export: withPayload(
            ({ target }) => exports.find((entry) => entry.target === target)?.target,
            (target): void => {
              this.exportTo(target);
            },
          ),
        },
        dblclick: {
          item: withPayload(
            ({ itemId }) => this.itemOf(itemId),
            (found): void => {
              this.emit('beuve-ura-jump', { item: found });
            },
          ),
        },
        submit: {
          editor: withPayload(
            ({ itemId }) => this.itemOf(itemId),
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

  private moveCursor(step: 1 | -1): void {
    const ordered = this.ordered();
    this.cursor = Math.min(Math.max(0, this.cursor + step), Math.max(0, ordered.length - 1));
    this.editingId = undefined;
    void this.revealCursor();
  }

  /** Staged items first, in export order, then withdrawn and addressed ones. */
  private ordered(): UraItemView[] {
    return [
      ...this.items.filter((item) => item.status.kind === 'staged'),
      ...this.items.filter((item) => item.status.kind !== 'staged'),
    ];
  }

  /** Open in Editor: the item's file at its current first line (line 1 for file notes and outdated items). */
  private openInEditor(item: UraItemView): void {
    const target = item.placement.kind === 'current' ? item.placement.anchor : item.anchor;
    if (target.kind === 'change') {
      return;
    }
    const line =
      target.kind === 'lines' && item.placement.kind === 'current' ? target.startLine : 1;
    this.emit('beuve-open-editor', { path: target.path, line });
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
    this.verdictRefusal = resolved.refusal ?? '';
    if (resolved.refusal === undefined) {
      this.emit('beuve-ura-set-verdict', { verdict: chosen });
    }
  }

  private blockers(): number {
    return this.items.filter((item) => item.status.kind === 'staged' && item.severity === 'blocker')
      .length;
  }

  private exportTo(target: UraExportTarget): void {
    this.emit('beuve-ura-export', { target });
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
      data-action="item"
      data-item-id=${item.id}
    >
      <div class="meta">
        <span class="severity ${item.severity}">${labels.severity}</span>
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
            : html`<span class="suggestion" title="Carries a suggested change">suggestion</span>`
        }
        <span class="origin ${item.origin.kind}">${status === '' ? labels.origin : status}</span>
      </div>
      <div class="title">${parseInlineTitle(item.title).map((span) => renderInlineSpan(span))}</div>
      ${
        item.suggestedPatch !== undefined && (index === this.cursor || this.editingId === item.id)
          ? html`<beuve-patch-preview .patch=${item.suggestedPatch}></beuve-patch-preview>`
          : nothing
      }
      ${this.editingId === item.id ? this.renderEditor(item) : nothing}
    </li>`;
  }

  private renderEditor(item: UraItemView): TemplateResult {
    return html`<form class="editor" data-action="editor" data-item-id=${item.id}>
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
      ${this.renderSuggestionActions(item)}
      <div class="row">
        <span class="spacer"></span>
        <button type="button" title="Cancel (Esc)" data-action="cancel-edit">Cancel</button>
        <button type="submit" class="primary" title=${`Save (${this.saveKey()})`}>Save</button>
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
          ? html`<button type="button" data-action="edit-suggestion" data-item-id=${item.id}>
              ${item.suggestedPatch === undefined ? 'Suggest a change…' : 'Edit suggestion…'}
            </button>`
          : nothing
      }
      ${
        item.suggestedPatch === undefined
          ? nothing
          : html`<button type="button" data-action="remove-suggestion" data-item-id=${item.id}>
              Remove suggestion
            </button>`
      }
    </div>`;
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
          ? this.verdictNotice === ''
            ? nothing
            : html`<p class="note" role="status">${this.verdictNotice}</p>`
          : html`<p class="note error" role="alert">${this.verdictRefusal}</p>`
      }
      ${this.github === undefined ? nothing : this.renderGithub(this.github)}
      <div class="exports">
        ${exports
          .filter((entry) => entry.target !== 'github' || this.github === undefined)
          .map(
            (entry) =>
              html`<button
                type="button"
                title=${entry.title}
                ?disabled=${!this.hasSession || this.exporting}
                data-action="export"
                data-target=${entry.target}
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
        ${stagedCount === 0 ? 'Nothing staged: an export carries only the verdict. ' : ''}Agents
        read the same review over MCP (<code>beuve_read_human_review</code>).
      </p>
    </section>`;
  }

  /** Post to GitHub: a button, then a confirmation with what goes inline and into the body. */
  private renderGithub(github: GithubDockState): TemplateResult {
    if (!github.isSignedIn) {
      return html`<p class="note">Post to ${github.target}: ${github.signInHint}</p>`;
    }
    const { post } = github;
    switch (post.kind) {
      case 'idle':
      case 'failed':
      case 'head-moved': {
        return html`<div class="github">
          <button
            type="button"
            class="primary"
            ?disabled=${!this.hasSession}
            title="Post the staged items as one review on ${github.target}"
            @click=${(): void => {
              this.emit('beuve-github-preview', {});
            }}
          >
            Post review to GitHub…
          </button>
          ${post.kind === 'failed' ? html`<p class="note error" role="alert">${post.text}</p>` : nothing}
          ${
            post.kind === 'head-moved'
              ? html`<p class="note" role="status">
                  The PR changed since you opened this; review the new commits first.
                </p>`
              : nothing
          }
        </div>`;
      }
      case 'busy': {
        return html`<div class="github"><p class="note" role="status">${post.text}</p></div>`;
      }
      case 'confirm': {
        return html`<div class="github confirm" role="group" aria-label="Confirm posting">
          <p class="note">Post to ${github.target}: ${describeReviewPreview(post.preview)}</p>
          <div class="actions">
            <button
              type="button"
              @click=${(): void => {
                this.emit('beuve-github-cancel', {});
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              class="primary"
              @click=${(): void => {
                this.emit('beuve-github-post', {});
              }}
            >
              Post
            </button>
          </div>
        </div>`;
      }
      case 'own-pull-request': {
        return html`<div class="github confirm" role="group" aria-label="Post as comment">
          <p class="note">${post.message} Post as comment instead?</p>
          <div class="actions">
            <button
              type="button"
              @click=${(): void => {
                this.emit('beuve-github-cancel', {});
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              class="primary"
              @click=${(): void => {
                this.emit('beuve-github-post', { verdict: 'comment' });
              }}
            >
              Post as comment
            </button>
          </div>
        </div>`;
      }
      case 'posted': {
        return html`<div class="github">
          <p class="note" role="status">
            ${post.text}
            <button
              type="button"
              class="link"
              title=${post.url}
              @click=${(): void => {
                this.emit('beuve-open-link', { url: post.url });
              }}
            >
              View on GitHub
            </button>
          </p>
          <button
            type="button"
            @click=${(): void => {
              this.emit('beuve-github-preview', {});
            }}
          >
            Post again…
          </button>
        </div>`;
      }
    }
  }

  private saveKey(): string {
    const platform = keyPlatformOf(this.platform);
    return displayAccelerator(platform === 'mac' ? 'Cmd+Return' : 'Ctrl+Return', platform);
  }

  /** Runs a Review ▸ Note command, or Open in Editor, on the item under the cursor. */
  runCommand(id: CommandId): boolean {
    const ordered = this.ordered();
    const current = ordered[this.cursor];
    switch (id) {
      case 'dock-move': {
        return true;
      }
      case 'dock-move-up':
      case 'dock-move-down': {
        if (current !== undefined) {
          this.move(current, id === 'dock-move-down' ? 1 : -1);
        }
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
        if (current !== undefined) {
          this.transition(current, current.status.kind === 'withdrawn' ? 'staged' : 'withdrawn');
        }
        return true;
      }
      case 'dock-addressed': {
        if (current !== undefined) {
          this.transition(current, current.status.kind === 'addressed' ? 'staged' : 'addressed');
        }
        return true;
      }
      default: {
        return false;
      }
    }
  }

  /** Puts the cursor on item `itemId`, for a context menu opened on it. */
  selectItem(itemId: string): void {
    const index = this.ordered().findIndex((item) => item.id === itemId);
    if (index !== -1) {
      this.cursor = index;
    }
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
            ordered.length === 0
              ? html`<p class="empty">
                  ${
                    this.hasSession
                      ? 'Nothing staged yet. Choose Review ▸ Add Note on a diff selection, or Stage on a chat answer.'
                      : 'Open a review session to stage notes.'
                  }
                </p>`
              : html`<ol aria-label="Staged review items">
                  ${ordered.map((item, index) => this.renderItem(item, index))}
                </ol>`
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
    if (changed.has('chosenVerdict') || changed.has('verdictNotice')) {
      this.verdictRefusal = '';
    }
  }
}

const inPlaceKeys: Readonly<Record<string, CommandId>> = {
  Enter: 'dock-show',
  ' ': 'dock-edit',
  Delete: 'dock-withdraw',
  Backspace: 'dock-withdraw',
  'Alt+ArrowUp': 'dock-move-up',
  'Alt+ArrowDown': 'dock-move-down',
};

/** ⌘/Ctrl+Enter in the editor saves, as Enter in its title does. */
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
