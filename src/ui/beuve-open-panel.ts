import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';

import type {
  CreateLocalSessionRequest,
  IpcResult,
  OpenPullRequestRequest,
  RepositoryInspectionView,
  SessionSummary,
} from '#contract/ipc-contract.ts';

import { describePullRequestState } from './describe-pull-request-state.ts';
import { displayKey } from './display-key.ts';
import { findKnownClone } from './find-known-clone.ts';
import { formatRelativeTime } from './format-relative-time.ts';
import { parseOpenQuery } from './parse-open-query.ts';
import type { OpenQuery } from './parse-open-query.ts';
import { rankRecentSessions } from './rank-recent-sessions.ts';
import { shortenPath } from './shorten-path.ts';

/** Shows the system folder picker; `undefined` when cancelled or unavailable. */
export type FolderChooser = (defaultPath: string | undefined) => Promise<string | undefined>;

/** Reads a folder's repository and branches (`repository:inspect`). */
export type RepositoryInspector = (path: string) => Promise<IpcResult<RepositoryInspectionView>>;

/** A failure to show in the pull request or local branch step. */
export interface OpenFailure {
  readonly message: string;
  readonly remedy?: string;
}

type Step = 'list' | 'pull' | 'local';

type Row =
  | { readonly kind: 'open-pull'; readonly query: Extract<OpenQuery, { kind: 'pull-request' }> }
  | { readonly kind: 'open-folder'; readonly path: string }
  | { readonly kind: 'session'; readonly session: SessionSummary }
  | { readonly kind: 'step'; readonly step: 'pull' | 'local' };

/**
 * The one place sessions are opened from: the ⌘O dialog and the empty main area. A single input
 * takes a pull request link (Enter opens it, in the clone the reviewer last used for that
 * repository), a folder path, or words that filter the recent sessions; arrow keys pick a row.
 * Two steps cover the rest: "Pull request…" (link and local clone, with a folder picker) and
 * "Local branch…" (folder, then head and base suggested from git). Emits
 * `beuve-select-session { sessionId }`, `beuve-open-pull-request` and `beuve-open-repository`;
 * `beuve-open-close` asks the dialog to close. `beuve-app` does the IPC.
 */
@customElement('beuve-open-panel')
export class BeuveOpenPanel extends LitElement {
  static override styles = css`
    :host {
      display: block;
      color: var(--beuve-text);
    }

    .query {
      box-sizing: border-box;
      width: 100%;
      padding: var(--beuve-space-2) var(--beuve-space-3);
      border: 1px solid var(--beuve-border);
      border-radius: var(--beuve-radius);
      background: var(--beuve-bg);
      color: var(--beuve-text);
      font: inherit;
      font-size: 14px;
    }

    input:focus {
      border-color: var(--beuve-accent);
      outline: none;
    }

    ol {
      display: grid;
      gap: 1px;
      margin: var(--beuve-space-2) 0 0;
      padding: 0;
      list-style: none;
    }

    li {
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr) auto;
      align-items: baseline;
      column-gap: var(--beuve-space-2);
      padding: 6px var(--beuve-space-2);
      border-radius: var(--beuve-radius);
      cursor: pointer;
    }

    li[aria-selected='true'] {
      background: var(--beuve-accent-soft);
    }

    li.separated {
      margin-top: var(--beuve-space-2);
      border-top: 1px solid var(--beuve-border);
      border-radius: 0 0 var(--beuve-radius) var(--beuve-radius);
      padding-top: var(--beuve-space-2);
    }

    .glyph {
      font: var(--beuve-font-mono);
      font-size: 11px;
      color: var(--beuve-text-muted);
      text-align: right;
      white-space: nowrap;
    }

    .line {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .detail {
      grid-column: 2 / 4;
      overflow: hidden;
      font: var(--beuve-font-small);
      color: var(--beuve-text-muted);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .when {
      font: var(--beuve-font-small);
      color: var(--beuve-text-muted);
      white-space: nowrap;
    }

    .state.ok {
      color: var(--beuve-ok);
    }

    .state.merged {
      color: var(--beuve-violet);
    }

    .state.danger {
      color: var(--beuve-danger);
    }

    .hint {
      margin: var(--beuve-space-3) 0 0;
      font: var(--beuve-font-small);
      color: var(--beuve-text-muted);
    }

    form {
      display: grid;
      grid-template-columns: 96px minmax(0, 1fr);
      align-items: baseline;
      gap: var(--beuve-space-2) var(--beuve-space-3);
    }

    form label {
      font: var(--beuve-font-small);
      color: var(--beuve-text-muted);
      text-align: right;
    }

    .field {
      display: flex;
      gap: var(--beuve-space-2);
      min-width: 0;
    }

    .field input,
    .refs input {
      flex: 1;
      min-width: 0;
      padding: var(--beuve-space-1) var(--beuve-space-2);
      border: 1px solid var(--beuve-border);
      border-radius: var(--beuve-radius);
      background: var(--beuve-bg);
      color: var(--beuve-text);
      font: var(--beuve-font-mono);
    }

    .refs {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
      align-items: center;
      gap: var(--beuve-space-2);
    }

    .refs span {
      color: var(--beuve-text-muted);
    }

    .note {
      grid-column: 2;
      margin: calc(-1 * var(--beuve-space-1)) 0 0;
      font: var(--beuve-font-small);
      color: var(--beuve-text-muted);
      overflow-wrap: anywhere;
    }

    .actions {
      grid-column: 2;
      display: flex;
      align-items: center;
      gap: var(--beuve-space-3);
    }

    button {
      padding: var(--beuve-space-1) var(--beuve-space-3);
      border: 1px solid var(--beuve-border);
      border-radius: var(--beuve-radius);
      background: var(--beuve-surface-sunken);
      color: var(--beuve-text);
      font: inherit;
      cursor: pointer;
      white-space: nowrap;
    }

    button.primary {
      border-color: var(--beuve-accent);
      background: var(--beuve-accent);
      color: #fff;
    }

    button:disabled {
      opacity: 0.6;
      cursor: default;
    }

    .back {
      margin-bottom: var(--beuve-space-3);
      padding: 0;
      border: none;
      background: none;
      font: var(--beuve-font-small);
      color: var(--beuve-text-muted);
    }

    .error {
      grid-column: 2;
      margin: 0;
      font: var(--beuve-font-small);
      color: var(--beuve-danger);
      overflow-wrap: anywhere;
    }

    code,
    kbd {
      font: var(--beuve-font-mono);
      font-size: 11px;
    }
  `;

  private now = Temporal.Now.instant();

  private readonly onQueryInput = (event: InputEvent): void => {
    this.text = (event.currentTarget as HTMLInputElement).value;
    this.cursor = 0;
  };

  private readonly onQueryKeyDown = (event: KeyboardEvent): void => {
    const rows = this.rows();
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step !== undefined || (event.ctrlKey && (event.key === 'n' || event.key === 'p'))) {
      event.preventDefault();
      const delta = step ?? (event.key === 'n' ? 1 : -1);
      this.cursor = (this.cursor + delta + rows.length) % rows.length;
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const row = rows[this.cursor];
      if (row !== undefined) {
        this.activate(row, event.shiftKey);
      }
      return;
    }
    const row = rows[this.cursor];
    if (event.key === 'Tab' && row?.kind === 'open-pull') {
      event.preventDefault();
      this.activate(row, true);
      return;
    }
    if (!(event.key === 'Escape' && this.closable)) {
      return;
    }

    event.preventDefault();
    this.emit('beuve-open-close', {});
  };

  private readonly onFormKeyDown = (event: KeyboardEvent): void => {
    event.stopPropagation();
    if (event.key !== 'Escape') {
      return;
    }

    event.preventDefault();
    this.step = 'list';
    this.focus();
  };

  private readonly onPullRefInput = (event: InputEvent): void => {
    this.pullRef = (event.currentTarget as HTMLInputElement).value;
    const parsed = parseOpenQuery(this.pullRef);
    const clone =
      parsed.kind === 'pull-request' && this.clonePath === ''
        ? findKnownClone(this.sessions, parsed)
        : undefined;
    if (clone === undefined) {
      return;
    }
    this.clonePath = clone;
    this.cloneNote = 'The clone you used last time for this repository.';
  };

  private readonly onSubmitPull = (event: SubmitEvent): void => {
    event.preventDefault();
    const repoPath = this.clonePath.trim();
    this.emitPull({ ref: this.pullRef.trim(), ...(repoPath !== '' && { repoPath }) });
  };

  private readonly onChooseClone = async (): Promise<void> => {
    const chosen = await this.chooseFolder?.(this.clonePath || undefined);
    if (chosen === undefined) {
      return;
    }

    this.clonePath = chosen;
    this.cloneNote = '';
  };

  private readonly onRepoChange = (event: Event): void => {
    const path = (event.currentTarget as HTMLInputElement).value.trim();
    if (path === '' || path === this.inspection?.root) {
      return;
    }

    this.repoPath = path;
    void this.inspectFolder(path);
  };

  private readonly onChooseRepo = async (): Promise<void> => {
    const chosen = await this.chooseFolder?.(this.repoPath || undefined);
    if (chosen === undefined) {
      return;
    }

    this.repoPath = chosen;
    await this.inspectFolder(chosen);
  };

  private readonly onSubmitLocal = (event: SubmitEvent): void => {
    event.preventDefault();
    const detail: CreateLocalSessionRequest = {
      repoPath: this.inspection?.root ?? this.repoPath.trim(),
      baseRef: this.baseRef.trim(),
      headRef: this.headRef.trim(),
    };
    this.emit('beuve-open-repository', detail);
  };

  /** Recent sessions, as `session:list` returns them. */
  @property({ attribute: false }) accessor sessions: readonly SessionSummary[] = [];
  @property({ type: Boolean }) accessor openingPull = false;
  @property({ type: Boolean }) accessor openingLocal = false;
  @property({ attribute: false }) accessor pullFailure: OpenFailure | undefined;
  @property({ attribute: false }) accessor localFailure: OpenFailure | undefined;
  @property({ attribute: false }) accessor chooseFolder: FolderChooser | undefined;
  @property({ attribute: false }) accessor inspect: RepositoryInspector | undefined;
  /** `process.platform`, for writing shortcuts the platform's way. */
  @property() accessor platform = '';
  /** In the dialog Escape on the list closes it; on the empty page there is nothing to close. */
  @property({ type: Boolean }) accessor closable = false;

  @state() accessor step: Step = 'list';
  @state() accessor text = '';
  @state() accessor cursor = 0;
  @state() accessor pullRef = '';
  @state() accessor clonePath = '';
  @state() accessor cloneNote = '';
  @state() accessor repoPath = '';
  @state() accessor inspection: RepositoryInspectionView | undefined;
  @state() accessor inspectError = '';
  @state() accessor headRef = '';
  @state() accessor baseRef = '';

  private rows(): Row[] {
    const parsed = parseOpenQuery(this.text);
    const filter = parsed.kind === 'filter' ? parsed.text : '';
    const isRecent = parsed.kind === 'empty' || parsed.kind === 'filter';
    return [
      ...(parsed.kind === 'pull-request' ? [{ kind: 'open-pull', query: parsed } as const] : []),
      ...(parsed.kind === 'path' ? [{ kind: 'open-folder', path: parsed.path } as const] : []),
      ...(isRecent
        ? rankRecentSessions(this.sessions, filter).map((session): Row => ({
            kind: 'session',
            session,
          }))
        : []),
      { kind: 'step', step: 'pull' },
      { kind: 'step', step: 'local' },
    ];
  }

  /** `edit` (Shift+Enter, or Tab on a link) opens the pull request step instead of opening at once. */
  private activate(row: Row, isEditing: boolean): void {
    switch (row.kind) {
      case 'session': {
        this.emit('beuve-select-session', { sessionId: row.session.id });
        return;
      }
      case 'open-pull': {
        const clone = findKnownClone(this.sessions, row.query);
        if (clone !== undefined && !isEditing) {
          this.emitPull({ ref: row.query.ref, repoPath: clone });
          return;
        }
        this.showPullStep(row.query.ref, clone);
        return;
      }
      case 'open-folder': {
        this.showLocalStep(row.path);
        return;
      }
      case 'step': {
        if (row.step === 'pull') {
          this.showPullStep('', undefined);
        } else {
          this.showLocalStep('');
        }
      }
    }
  }

  private async inspectFolder(path: string): Promise<void> {
    if (this.inspect === undefined) {
      return;
    }
    this.inspectError = '';
    const inspected = await this.inspect(path);
    if (path !== this.repoPath) {
      return;
    }
    if (!inspected.ok) {
      this.inspection = undefined;
      this.inspectError = inspected.error.message;
      return;
    }
    const view = inspected.value;
    this.inspection = view;
    this.headRef = view.currentBranch ?? 'HEAD';
    this.baseRef =
      view.defaultBase === undefined || view.defaultBase === this.headRef
        ? (view.branches.find((branch) => branch.name !== this.headRef)?.name ?? '')
        : view.defaultBase;
    void this.updateComplete.then(() => {
      this.renderRoot.querySelector<HTMLInputElement>('input[name=head]')?.select();
    });
  }

  private emitPull(detail: OpenPullRequestRequest): void {
    this.emit('beuve-open-pull-request', detail);
  }

  private emit(name: string, detail: object): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private renderRow(row: Row, index: number, rows: readonly Row[]): TemplateResult {
    const selected = index === this.cursor ? 'true' : 'false';
    const isSeparated = row.kind === 'step' && rows[index - 1]?.kind !== 'step' && index > 0;
    const click = (): void => {
      this.cursor = index;
      this.activate(row, false);
    };
    return html`<li
      role="option"
      aria-selected=${selected}
      class=${isSeparated ? 'separated' : ''}
      @click=${click}
      @mousemove=${(): void => {
        this.cursor = index;
      }}
    >
      ${this.renderRowContent(row)}
    </li>`;
  }

  private renderRowContent(row: Row): TemplateResult {
    switch (row.kind) {
      case 'open-pull': {
        const { query: pull } = row;
        const clone = findKnownClone(this.sessions, pull);
        return html`<span class="glyph">#${pull.number}</span>
          <span class="line">Open ${pull.owner}/${pull.repo}#${pull.number}</span>
          <span class="when"><kbd>⏎</kbd></span>
          <span class="detail"
            >${
              clone === undefined
                ? 'Choose the local clone to fetch it into'
                : html`into ${shortenPath(clone)} · <kbd>Tab</kbd> to change`
            }</span
          >`;
      }
      case 'open-folder': {
        return html`<span class="glyph">dir</span>
          <span class="line">Review a branch in ${row.path}</span>
          <span class="when"><kbd>⏎</kbd></span>`;
      }
      case 'session': {
        return this.renderSession(row.session);
      }
      case 'step': {
        return row.step === 'pull'
          ? html`<span class="glyph">PR</span>
              <span class="line">Pull request…</span>
              <span class="when"></span>
              <span class="detail">A GitHub link or owner/repo#n, fetched into a local clone</span>`
          : html`<span class="glyph">git</span>
              <span class="line">Local branch…</span>
              <span class="when"></span>
              <span class="detail">Any folder in a repository; compare a head with a base</span>`;
      }
    }
  }

  private renderSession(session: SessionSummary): TemplateResult {
    const { source } = session;
    const folder = source.repoPath.split('/').findLast((part) => part !== '') ?? source.repoPath;
    const when = formatRelativeTime(session.updatedAt, this.now);
    const reviewed = session.lastReviewedSha === undefined ? 'not reviewed yet' : 'reviewed';
    if (source.kind === 'github-pull-request') {
      const { pullRequest } = session;
      const badge = pullRequest === undefined ? undefined : describePullRequestState(pullRequest);
      return html`<span class="glyph">#${source.number}</span>
        <span class="line">${pullRequest?.title ?? `${source.owner}/${source.repo}`}</span>
        <span class="when">${when}</span>
        <span class="detail"
          >${
            badge === undefined
              ? nothing
              : html`<span class="state ${badge.tone}">${badge.label}</span> · `
          }${source.owner}/${source.repo}
          · into ${pullRequest?.baseBranch ?? 'base'} · ${folder} · ${reviewed}</span
        >`;
    }
    return html`<span class="glyph">git</span>
      <span class="line">${folder} <code>${source.headRef}</code></span>
      <span class="when">${when}</span>
      <span class="detail" title=${source.repoPath}
        >against ${source.baseRef} · ${shortenPath(source.repoPath)} · ${reviewed}</span
      >`;
  }

  private renderList(): TemplateResult {
    const rows = this.rows();
    const hasRecent = rows.some((row) => row.kind === 'session');
    return html`
      <input
        class="query"
        aria-label="Open a pull request, a folder or a recent session"
        placeholder=${
          this.sessions.length === 0
            ? 'Paste a pull request link, or a folder path'
            : 'Paste a pull request link or folder path, or search recent reviews'
        }
        autocomplete="off"
        spellcheck="false"
        .value=${live(this.text)}
        @input=${this.onQueryInput}
        @keydown=${this.onQueryKeyDown}
      />
      <ol role="listbox" aria-label=${hasRecent ? 'Recent reviews and actions' : 'Actions'}>
        ${rows.map((row, index) => this.renderRow(row, index, rows))}
      </ol>
      <p class="hint">
        <kbd>↑</kbd> <kbd>↓</kbd> choose · <kbd>⏎</kbd> open
        ${this.closable ? html` · <kbd>Esc</kbd> close` : nothing} ·
        <kbd>${displayKey('⌘O', this.platform)}</kbd>
        opens this anywhere
      </p>
    `;
  }

  private renderFailure(failure: OpenFailure | undefined): TemplateResult | typeof nothing {
    if (failure === undefined) {
      return nothing;
    }
    return html`<p class="error" role="alert">
      ${failure.message}
      ${failure.remedy === undefined ? nothing : html`Run <code>${failure.remedy}</code>.`}
    </p>`;
  }

  private renderPull(): TemplateResult {
    return html`
      ${this.renderBack()}
      <form @submit=${this.onSubmitPull} @keydown=${this.onFormKeyDown}>
        <label for="ref">Pull request</label>
        <div class="field">
          <input
            id="ref"
            name="ref"
            required
            placeholder="https://github.com/owner/repo/pull/123 or owner/repo#123"
            autocomplete="off"
            spellcheck="false"
            .value=${live(this.pullRef)}
            @input=${this.onPullRefInput}
          />
        </div>
        <label for="clone">Local clone</label>
        <div class="field">
          <input
            id="clone"
            name="clone"
            placeholder="Remembered per repository after the first time"
            autocomplete="off"
            spellcheck="false"
            .value=${live(this.clonePath)}
            @input=${(event: InputEvent): void => {
              this.clonePath = (event.currentTarget as HTMLInputElement).value;
              this.cloneNote = '';
            }}
          />
          <button type="button" @click=${this.onChooseClone}>Choose…</button>
        </div>
        <p class="note">
          ${this.cloneNote === '' ? nothing : html`${this.cloneNote} `}beuve fetches the pull
          request into this clone; it never clones for you.
        </p>
        <div class="actions">
          <button class="primary" type="submit" ?disabled=${this.openingPull}>
            ${this.openingPull ? 'Fetching…' : 'Open pull request'}
          </button>
        </div>
        ${this.renderFailure(this.pullFailure)}
      </form>
    `;
  }

  private renderLocal(): TemplateResult {
    const view = this.inspection;
    const branches = view?.branches ?? [];
    return html`
      ${this.renderBack()}
      <form @submit=${this.onSubmitLocal} @keydown=${this.onFormKeyDown}>
        <label for="repo">Repository</label>
        <div class="field">
          <input
            id="repo"
            name="repo"
            required
            placeholder="/path/to/repository"
            autocomplete="off"
            spellcheck="false"
            .value=${live(this.repoPath)}
            @change=${this.onRepoChange}
          />
          <button type="button" @click=${this.onChooseRepo}>Choose…</button>
        </div>
        ${
          this.inspectError === ''
            ? view === undefined
              ? nothing
              : html`<p class="note">
                  ${view.root === this.repoPath ? 'A repository' : view.root}${
                    view.currentBranch === undefined ? nothing : html` · on ${view.currentBranch}`
                  }
                  · ${branches.length} branches
                </p>`
            : html`<p class="error">${this.inspectError}</p>`
        }
        <label for="head">Review</label>
        <div class="refs">
          <input
            id="head"
            name="head"
            required
            list="branches"
            aria-label="Head"
            autocomplete="off"
            spellcheck="false"
            .value=${live(this.headRef)}
            @input=${(event: InputEvent): void => {
              this.headRef = (event.currentTarget as HTMLInputElement).value;
            }}
          />
          <span>against</span>
          <input
            name="base"
            required
            list="branches"
            aria-label="Base"
            autocomplete="off"
            spellcheck="false"
            .value=${live(this.baseRef)}
            @input=${(event: InputEvent): void => {
              this.baseRef = (event.currentTarget as HTMLInputElement).value;
            }}
          />
        </div>
        <datalist id="branches">
          ${branches.map((branch) => html`<option value=${branch.name}></option>`)}
        </datalist>
        <p class="note">Shows what the head changed since it forked from the base.</p>
        <div class="actions">
          <button class="primary" type="submit" ?disabled=${this.openingLocal}>
            ${this.openingLocal ? 'Opening…' : 'Open'}
          </button>
        </div>
        ${this.renderFailure(this.localFailure)}
      </form>
    `;
  }

  private renderBack(): TemplateResult {
    return html`<button
      class="back"
      type="button"
      @click=${(): void => {
        this.step = 'list';
        this.focus();
      }}
    >
      ← Recent and links · <kbd>Esc</kbd>
    </button>`;
  }

  override focus(): void {
    void this.updateComplete.then(() => {
      const target =
        this.step === 'list'
          ? (this.renderRoot.querySelector<HTMLInputElement>(':scope .query') ?? undefined)
          : (this.renderRoot.querySelector<HTMLInputElement>(':scope form input') ?? undefined);
      target?.focus();
    });
  }

  /** Back to the list with an empty input, as the dialog opens. */
  reset(): void {
    this.step = 'list';
    this.text = '';
    this.cursor = 0;
    this.now = Temporal.Now.instant();
  }

  /** Shows the pull request step, e.g. for a link pasted into the palette. */
  showPullStep(ref: string, clone?: string): void {
    this.pullRef = ref;
    this.clonePath = clone ?? '';
    this.cloneNote = clone === undefined ? '' : 'The clone you used last time for this repository.';
    this.step = 'pull';
    void this.updateComplete.then(() => {
      const selector = ref === '' ? 'input[name=ref]' : 'input[name=clone]';
      this.renderRoot.querySelector<HTMLInputElement>(selector)?.focus();
    });
  }

  /** Shows the local branch step, inspecting `path` when given. */
  showLocalStep(path: string): void {
    this.repoPath = path;
    this.inspection = undefined;
    this.inspectError = '';
    this.step = 'local';
    void this.updateComplete.then(() => {
      this.renderRoot.querySelector<HTMLInputElement>('input[name=repo]')?.focus();
    });
    if (path !== '') {
      void this.inspectFolder(path);
    }
  }

  override render(): TemplateResult {
    switch (this.step) {
      case 'list': {
        return this.renderList();
      }
      case 'pull': {
        return this.renderPull();
      }
      case 'local': {
        return this.renderLocal();
      }
    }
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('pullFailure') && this.pullFailure !== undefined && this.step !== 'pull') {
      const parsed = parseOpenQuery(this.text);
      this.showPullStep(parsed.kind === 'pull-request' ? parsed.ref : this.pullRef, undefined);
    }
    const rows = this.rows();
    this.cursor = Math.min(this.cursor, rows.length - 1);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-open-panel': BeuveOpenPanel;
  }
}
