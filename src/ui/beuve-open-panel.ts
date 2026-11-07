import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { live } from 'lit/directives/live.js';

import type {
  CreateLocalSessionRequest,
  IpcResult,
  OpenPullRequestRequest,
  PullRequestBadgeView,
  RepositoryInspectionView,
  SessionSummary,
} from '#contract/ipc-contract.ts';

import { ActionDelegation } from './action-delegation.ts';
import { describePullRequestState } from './describe-pull-request-state.ts';
import { findKnownClone } from './find-known-clone.ts';
import { parseOpenQuery } from './parse-open-query.ts';
import type { OpenQuery } from './parse-open-query.ts';
import { rankRecentSessions } from './rank-recent-sessions.ts';
import { shortenPath } from './shorten-path.ts';
import { buttonStyles } from './primitives/button-styles.ts';
import './primitives/beuve-time.ts';

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

interface PressedRow {
  readonly index: number;
  readonly isEditing: boolean;
}

type Row =
  | {
      readonly kind: 'open-pull';
      readonly query: Extract<OpenQuery, { kind: 'pull-request' | 'branch' }>;
    }
  | { readonly kind: 'open-folder'; readonly path: string }
  | { readonly kind: 'session'; readonly session: SessionSummary }
  | { readonly kind: 'step'; readonly step: 'pull' | 'local' };

/**
 * The one place sessions are opened from: the File ▸ Open dialog and the empty main area. A single input
 * takes a pull request link (Enter opens it, in the clone the reviewer last used for that
 * repository), a folder path, or words that filter the recent sessions; arrow keys pick a row.
 * Two steps cover the rest: "Pull request…" (link and local clone, with a folder picker) and
 * "Local branch…" (folder, then head and base suggested from git). Emits
 * `beuve-select-session { sessionId }`, `beuve-open-pull-request` and `beuve-open-repository`;
 * `beuve-open-close` asks the dialog to close, and `beuve-open-pull-cancel` stops a pull request
 * fetch in flight. `beuve-app` does the IPC.
 */
@customElement('beuve-open-panel')
export class BeuveOpenPanel extends LitElement {
  static override styles = [
    buttonStyles,
    css`
      :host {
        display: block;
        color: var(--beuve-text);
      }

      .query {
        box-sizing: border-box;
        inline-size: 100%;
        padding: var(--beuve-space-2) var(--beuve-space-3);
        border: var(--beuve-border-width) solid var(--beuve-border);
        border-radius: var(--beuve-radius);
        background: var(--beuve-bg);
        color: var(--beuve-text);
        font: inherit;
        font-size: var(--beuve-font-size-body);
      }

      input:focus {
        border-color: var(--beuve-accent);
        outline: none;
      }

      ol {
        display: grid;
        gap: var(--beuve-space-px);
        margin: var(--beuve-space-2) 0 0;
        padding: 0;
        list-style: none;
      }

      li {
        display: grid;
        grid-template-columns: var(--beuve-size-glyph-column) minmax(0, 1fr) auto;
        align-items: baseline;
        column-gap: var(--beuve-space-2);
        padding: var(--beuve-space-1-5) var(--beuve-space-2);
        border-radius: var(--beuve-radius);
        cursor: pointer;
      }

      li {
        transition:
          background-color 80ms ease-out,
          transform 80ms ease-out;
      }

      li[aria-selected='true'] {
        background: var(--beuve-accent-soft);
      }

      li:active {
        transform: scale(0.985);
        background: var(--beuve-accent-soft);
        box-shadow: inset 0 0 0 var(--beuve-border-width) var(--beuve-accent);
      }

      li.pressed {
        background: var(--beuve-accent-soft);
        animation: press 140ms ease-out both;
      }

      @keyframes press {
        40% {
          transform: scale(0.97);
          box-shadow: inset 0 0 0 var(--beuve-border-width) var(--beuve-accent);
        }
        to {
          transform: scale(1);
          box-shadow: inset 0 0 0 var(--beuve-border-width) var(--beuve-accent);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        li {
          transition: none;
        }

        li:active {
          transform: none;
        }
      }

      li.separated {
        margin-block-start: var(--beuve-space-2);
        border-block-start: var(--beuve-border-width) solid var(--beuve-border);
        border-radius: 0 0 var(--beuve-radius) var(--beuve-radius);
        padding-block-start: var(--beuve-space-2);
      }

      .glyph {
        font: var(--beuve-font-code);
        font-size: var(--beuve-font-size-caption);
        color: var(--beuve-text-muted);
        text-align: end;
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

      li[aria-selected='false'] .when.enter {
        visibility: hidden;
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

      form {
        display: grid;
        grid-template-columns: var(--beuve-size-label-narrow) minmax(0, 1fr);
        align-items: baseline;
        gap: var(--beuve-space-2) var(--beuve-space-3);
      }

      form label {
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
        text-align: end;
      }

      .field {
        display: flex;
        gap: var(--beuve-space-2);
        min-inline-size: 0;
      }

      .field input,
      .refs input {
        flex: 1;
        min-inline-size: 0;
        padding: var(--beuve-space-1) var(--beuve-space-2);
        border: var(--beuve-border-width) solid var(--beuve-border);
        border-radius: var(--beuve-radius);
        background: var(--beuve-bg);
        color: var(--beuve-text);
        font: var(--beuve-font-code);
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

      .back {
        margin-block-end: var(--beuve-space-3);
      }

      .error {
        grid-column: 2;
        margin: 0;
        font: var(--beuve-font-small);
        color: var(--beuve-danger);
        overflow-wrap: anywhere;
      }

      code {
        font: var(--beuve-font-code);
        font-size: var(--beuve-font-size-caption);
      }
    `,
  ];

  private readonly onQueryInput = (event: InputEvent): void => {
    this.text = (event.currentTarget as HTMLInputElement).value;
    this.cursor = 0;
  };

  private readonly onQueryKeyDown = (event: KeyboardEvent): void => {
    const rows = this.rows();
    const step = cursorStep(event);
    if (step !== undefined) {
      event.preventDefault();
      this.cursor = (this.cursor + step + rows.length) % rows.length;
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const row = rows[this.cursor];
      if (row === undefined || this.pressed !== undefined) {
        return;
      }
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        this.activate(row, event.shiftKey);
        return;
      }
      // The row plays its press; `animationend` activates it.
      this.pressed = { index: this.cursor, isEditing: event.shiftKey };
      return;
    }
    if (!(event.key === 'Escape' && this.closable)) {
      return;
    }

    event.preventDefault();
    this.emit('beuve-open-close', {});
  };

  private readonly onCancelPull = (): void => {
    this.emit('beuve-open-pull-cancel', {});
  };

  private readonly onFormKeyDown = (event: KeyboardEvent): void => {
    event.stopPropagation();
    if (event.key !== 'Escape') {
      return;
    }

    event.preventDefault();
    if (this.closable) {
      this.emit('beuve-open-close', {});
      return;
    }
    this.step = 'list';
    this.focus();
  };

  private readonly onPullRefInput = (event: InputEvent): void => {
    this.pullRef = (event.currentTarget as HTMLInputElement).value;
    const parsed = parseOpenQuery(this.pullRef);
    if ((parsed.kind !== 'pull-request' && parsed.kind !== 'branch') || this.clonePath !== '') {
      return;
    }
    const clone = findKnownClone(this.sessions, parsed);
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
  /** In the dialog Escape closes it from any step; on the empty page there is nothing to close. */
  @property({ type: Boolean }) accessor closable = false;

  @state() accessor step: Step = 'list';
  @state() accessor text = '';
  @state() accessor cursor = 0;
  /** The row Enter is pressing: it activates when its press animation ends. */
  @state() accessor pressed: PressedRow | undefined;
  @state() accessor pullRef = '';
  @state() accessor clonePath = '';
  @state() accessor cloneNote = '';
  @state() accessor repoPath = '';
  @state() accessor inspection: RepositoryInspectionView | undefined;
  @state() accessor inspectError = '';
  @state() accessor headRef = '';
  @state() accessor baseRef = '';

  constructor() {
    super();
    // ADR 0074: the rows, through one listener per type.
    this.addController(
      new ActionDelegation(this, {
        click: {
          row: ({ index }): void => {
            const row = this.rows()[Number(index)];
            if (row === undefined) {
              return;
            }
            this.cursor = Number(index);
            this.activate(row, false);
          },
          'change-clone': ({ index }, event): void => {
            event.stopPropagation();
            const row = this.rows()[Number(index)];
            if (row !== undefined) {
              this.activate(row, true);
            }
          },
        },
        animationend: {
          row: ({ index }): void => {
            const { pressed } = this;
            if (pressed?.index !== Number(index)) {
              return;
            }
            this.pressed = undefined;
            const row = this.rows()[pressed.index];
            if (row !== undefined) {
              this.activate(row, pressed.isEditing);
            }
          },
        },
        mousemove: {
          row: ({ index }): void => {
            this.cursor = Number(index);
          },
        },
      }),
    );
  }

  private rows(): Row[] {
    const parsed = parseOpenQuery(this.text);
    const rows: Row[] = [];
    switch (parsed.kind) {
      case 'pull-request':
      case 'branch': {
        rows.push({ kind: 'open-pull', query: parsed });
        break;
      }
      case 'path': {
        rows.push({ kind: 'open-folder', path: parsed.path });
        break;
      }
      case 'empty':
      case 'filter': {
        let filter = '';
        if (parsed.kind === 'filter') {
          filter = parsed.text;
        }
        for (const session of rankRecentSessions(this.sessions, filter)) {
          rows.push({ kind: 'session', session });
        }
        break;
      }
    }
    rows.push({ kind: 'step', step: 'pull' }, { kind: 'step', step: 'local' });
    return rows;
  }

  /** `edit` (Shift+Enter, or Change… on a link) opens the pull request step instead of opening at once. */
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
    this.baseRef = baseFor(view, this.headRef);
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
    const isSeparated = row.kind === 'step' && rows[index - 1]?.kind !== 'step' && index > 0;
    return html`<li
      role="option"
      aria-selected=${index === this.cursor ? 'true' : 'false'}
      class=${classMap({ separated: isSeparated, pressed: this.pressed?.index === index })}
      data-action="row"
      data-index=${index}
    >
      ${this.renderRowContent(row, index)}
    </li>`;
  }

  private renderRowContent(row: Row, index: number): TemplateResult {
    switch (row.kind) {
      case 'open-pull': {
        const { query: pull } = row;
        const clone = findKnownClone(this.sessions, pull);
        return html`${
            pull.kind === 'branch'
              ? html`<span class="glyph">br</span>
                  <span class="line">Follow ${pull.owner}/${pull.repo}:${pull.branch}</span>`
              : html`<span class="glyph">#${pull.number}</span>
                  <span class="line">Open ${pull.owner}/${pull.repo}#${pull.number}</span>`
          }
          <span class="when enter" aria-hidden="true">↩</span>
          <span class="detail"
            >${
              clone === undefined
                ? 'Choose the local clone to fetch it into'
                : html`into ${shortenPath(clone)} ·
                    <button
                      type="button"
                      class="button link"
                      data-action="change-clone"
                      data-index=${index}
                    >
                      Change…
                    </button>`
            }</span
          >`;
      }
      case 'open-folder': {
        return html`<span class="glyph">dir</span>
          <span class="line">Review a branch in ${row.path}</span>
          <span class="when enter" aria-hidden="true">↩</span>`;
      }
      case 'session': {
        return this.renderSession(row.session);
      }
      case 'step': {
        if (row.step === 'pull') {
          return html`<span class="glyph">PR</span>
            <span class="line">Pull request or branch…</span>
            <span class="when"></span>
            <span class="detail"
              >A GitHub link, owner/repo#n or owner/repo:branch, fetched into a local clone</span
            >`;
        }
        return html`<span class="glyph">git</span>
          <span class="line">Local branch…</span>
          <span class="when"></span>
          <span class="detail">Any folder in a repository; compare a head with a base</span>`;
      }
    }
  }

  private renderSession(session: SessionSummary): TemplateResult {
    const { source } = session;
    const folder = source.repoPath.split('/').findLast((part) => part !== '') ?? source.repoPath;
    const when = html`<beuve-time datetime=${session.updatedAt} format="relative"></beuve-time>`;
    const reviewed = reviewedText(session);
    if (source.kind === 'github-pull-request') {
      const { pullRequest } = session;
      return html`<span class="glyph">#${source.number}</span>
        <span class="line">${pullRequest?.title ?? `${source.owner}/${source.repo}`}</span>
        <span class="when">${when}</span>
        <span class="detail"
          >${
            pullRequest === undefined ? nothing : renderStateBadge(pullRequest)
          }${source.owner}/${source.repo}
          · into ${pullRequest?.baseBranch ?? 'base'} · ${folder} · ${reviewed}</span
        >`;
    }
    if (source.kind === 'remote-branch') {
      const isGone = session.remoteBranch?.state === 'gone';
      return html`<span class="glyph">br</span>
        <span class="line">${source.owner}/${source.repo} <code>${source.branch}</code></span>
        <span class="when">${when}</span>
        <span class="detail" title=${source.repoPath}
          >${isGone ? 'gone from GitHub · ' : nothing}following · ${shortenPath(source.repoPath)} ·
          ${reviewed}</span
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
        <label for="ref">Pull request or branch</label>
        <div class="field">
          <input
            id="ref"
            name="ref"
            required
            placeholder="A pull request or branch link, owner/repo#123 or owner/repo:branch"
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
          <button class="button large" type="button" @click=${this.onChooseClone}>Choose…</button>
        </div>
        <p class="note">
          ${this.cloneNote === '' ? nothing : html`${this.cloneNote} `}beuve fetches the pull
          request into this clone; it never clones for you.
        </p>
        <div class="actions">
          <button class="button large primary" type="submit" ?disabled=${this.openingPull}>
            ${this.openingPull ? 'Fetching…' : 'Open pull request'}
          </button>
          ${
            this.openingPull
              ? html`<button
                  class="button large"
                  type="button"
                  data-action="cancel-pull"
                  @click=${this.onCancelPull}
                >
                  Cancel
                </button>`
              : nothing
          }
        </div>
        ${this.renderFailure(this.pullFailure)}
      </form>
    `;
  }

  /** What inspecting the folder found: its root and branch, or why it failed. */
  private renderInspection(view: RepositoryInspectionView | undefined): TemplateResult {
    if (this.inspectError !== '') {
      return html`<p class="error">${this.inspectError}</p>`;
    }
    if (view === undefined) {
      return html``;
    }
    return html`<p class="note">
      ${view.root === this.repoPath ? 'A repository' : view.root}${
        view.currentBranch === undefined ? nothing : html` · on ${view.currentBranch}`
      }
      · ${view.branches.length} branches
    </p>`;
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
          <button class="button large" type="button" @click=${this.onChooseRepo}>Choose…</button>
        </div>
        ${this.renderInspection(view)}
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
          ${branches.map((branch) => {
            return html`<option value=${branch.name}></option>`;
          })}
        </datalist>
        <p class="note">Shows what the head changed since it forked from the base.</p>
        <div class="actions">
          <button class="button large primary" type="submit" ?disabled=${this.openingLocal}>
            ${this.openingLocal ? 'Opening…' : 'Open'}
          </button>
        </div>
        ${this.renderFailure(this.localFailure)}
      </form>
    `;
  }

  private renderBack(): TemplateResult {
    return html`<button
      class="button quiet back"
      type="button"
      @keydown=${this.onFormKeyDown}
      @click=${(): void => {
        this.step = 'list';
        this.focus();
      }}
    >
      ‹ Back
    </button>`;
  }

  override focus(): void {
    void this.updateComplete.then(() => {
      let selector = 'form input';
      if (this.step === 'list') {
        selector = '.query';
      }
      this.renderRoot.querySelector<HTMLInputElement>(selector)?.focus();
    });
  }

  /** Back to the list with an empty input, as the dialog opens. */
  reset(): void {
    this.step = 'list';
    this.text = '';
    this.cursor = 0;
    this.pressed = undefined;
  }

  /** Shows the pull request step, e.g. for a link pasted into the palette. */
  showPullStep(ref: string, clone?: string): void {
    this.pullRef = ref;
    this.clonePath = clone ?? '';
    this.cloneNote = '';
    if (clone !== undefined) {
      this.cloneNote = 'The clone you used last time for this repository.';
    }
    this.step = 'pull';
    void this.updateComplete.then(() => {
      let selector = 'input[name=clone]';
      if (ref === '') {
        selector = 'input[name=ref]';
      }
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

  protected override firstUpdated(): void {
    this.focus();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('pullFailure') && this.pullFailure !== undefined && this.step !== 'pull') {
      const parsed = parseOpenQuery(this.text);
      let ref = this.pullRef;
      if (parsed.kind === 'pull-request' || parsed.kind === 'branch') {
        ref = parsed.ref;
      }
      this.showPullStep(ref, undefined);
    }
    const rows = this.rows();
    this.cursor = Math.min(this.cursor, rows.length - 1);
  }
}

const arrowSteps: Readonly<Record<string, number>> = { ArrowDown: 1, ArrowUp: -1 };
const controlSteps: Readonly<Record<string, number>> = { n: 1, p: -1 };

/** How far a key moves the list's cursor: the arrows, or Ctrl+N and Ctrl+P. */
function cursorStep(event: KeyboardEvent): number | undefined {
  const step = arrowSteps[event.key];
  if (step !== undefined || !event.ctrlKey) {
    return step;
  }
  return controlSteps[event.key];
}

/** The repository's default base, or another branch when that is the head itself. */
function baseFor(view: RepositoryInspectionView, headRef: string): string {
  if (view.defaultBase !== undefined && view.defaultBase !== headRef) {
    return view.defaultBase;
  }
  return view.branches.find((branch) => branch.name !== headRef)?.name ?? '';
}

function reviewedText(session: SessionSummary): string {
  if (session.lastReviewedSha === undefined) {
    return 'not reviewed yet';
  }
  return 'reviewed';
}

function renderStateBadge(pullRequest: PullRequestBadgeView): TemplateResult {
  const badge = describePullRequestState(pullRequest);
  return html`<span class="state ${badge.tone}">${badge.label}</span> · `;
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-open-panel': BeuveOpenPanel;
  }
}
