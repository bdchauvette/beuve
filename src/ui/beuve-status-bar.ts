import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import type {
  AppInfo,
  FileReviewProgressView,
  GithubAuthStatusView,
  LspServerView,
  RemoteBranchView,
  ReviewRangeView,
} from '#contract/ipc-contract.ts';

import { ActionDelegation } from './action-delegation.ts';
import { countNoun } from './count-noun.ts';
import type { StatusNotice } from './describe-editor-open.ts';
import { describeGithubAuth } from './describe-github-auth.ts';
import { describeLspStatus } from './describe-lsp-status.ts';
import { describeRemoteBranch } from './describe-remote-branch.ts';
import { describeReviewProgress } from './describe-review-progress.ts';
import { formatControlStyles } from './format-control-styles.ts';
import { pathText } from './path-text.ts';
import { buttonStyles } from './primitives/button-styles.ts';
import './beuve-review-range.ts';
import './primitives/beuve-commit.ts';
import './primitives/beuve-time.ts';
import { statusDotStyles } from './primitives/status-dot-styles.ts';
import type { SaveState } from './save-state-from.ts';

/** `beuve-status-open-url`: a link in a status popover, for the owner to open. */
export interface StatusOpenUrlDetail {
  readonly url: string;
}

/** `beuve-status-popover`: which popover (`lsp` or `save`) just opened. */
export interface StatusPopoverDetail {
  readonly id: string;
}

/**
 * Bottom bar: the reviewer's progress through the open review, how many files are marked reviewed,
 * what the diff shows (the range menu, ADR 0142) and whether the head is saved (ADR 0157; click for Save Progress and Remove Last Saved
 * Progress), the language servers (click for each one's state), a transient notice, a followed
 * branch's state, GitHub sign-in and app version. A pull request's CI and whose turn it is are in
 * the title bar. Its text is not selectable: these are controls and readouts, not content.
 *
 * Emits `beuve-status-action` (a catalog command), what `beuve-review-range` emits, `beuve-status-open-url` (a link in a popover)
 * and `beuve-status-popover` when a popover opens, so the owner can refresh what it shows.
 */
/** Server states and describer tones that are not dot tones themselves. */
const dotTones: Readonly<Record<string, string>> = {
  running: 'ok',
  starting: 'warn',
  stopping: 'warn',
  failed: 'danger',
  busy: 'accent',
};

@customElement('beuve-status-bar')
export class BeuveStatusBar extends LitElement {
  static override styles = [
    statusDotStyles,
    buttonStyles,
    formatControlStyles,
    css`
      :host {
        display: flex;
        align-items: center;
        gap: var(--beuve-space-4);
        padding: 0 var(--beuve-space-3);
        border-block-start: var(--beuve-border-width) solid var(--beuve-border);
        background: var(--beuve-surface-sunken);
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
        white-space: nowrap;
        user-select: none;
        -webkit-user-select: none;
      }

      .chip:has(+ [popover]:popover-open) {
        background: var(--beuve-surface-hover);
        color: var(--beuve-text);
      }

      .status-dot {
        margin-inline-end: var(--beuve-space-1);
      }

      [popover] {
        position: fixed;
        inset: auto;
        inset-block-end: calc(var(--beuve-statusbar-height) + var(--beuve-space-1));
        min-inline-size: var(--beuve-size-popover-min);
        max-inline-size: min(
          var(--beuve-size-popover),
          calc(var(--beuve-size-window-inline) - 2 * var(--beuve-space-3))
        );
        max-block-size: var(--beuve-size-window-block-50);
        margin: 0;
        padding: var(--beuve-space-2) var(--beuve-space-3);
        overflow: auto;
        border: var(--beuve-border-width) solid var(--beuve-border);
        border-radius: var(--beuve-radius);
        background: var(--beuve-surface);
        box-shadow: var(--beuve-shadow-small);
        color: var(--beuve-text);
        white-space: normal;
      }

      [popover].start {
        inset-inline-start: var(--beuve-space-3);
      }

      [popover].end {
        inset-inline-end: var(--beuve-space-3);
      }

      .popover-title {
        margin: 0 0 var(--beuve-space-2);
        color: var(--beuve-text-muted);
        font-weight: var(--beuve-font-weight-semibold);
      }

      .popover-note {
        margin: 0;
        color: var(--beuve-text-muted);
      }

      ul.rows {
        display: flex;
        flex-direction: column;
        gap: var(--beuve-space-1);
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .row {
        display: flex;
        align-items: baseline;
        gap: var(--beuve-space-2);
      }

      .row .detail {
        margin-inline-start: auto;
        padding-inline-start: var(--beuve-space-3);
        color: var(--beuve-text-muted);
        white-space: nowrap;
      }

      .row .grow {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .popover-actions {
        display: flex;
        justify-content: flex-end;
        margin-block-start: var(--beuve-space-2);
      }

      .notice {
        user-select: text;
        -webkit-user-select: text;
      }

      .spacer {
        flex: 1;
      }

      .notice {
        overflow: hidden;
        text-overflow: ellipsis;
        color: var(--beuve-text);
      }

      .notice.error {
        color: var(--beuve-danger);
      }

      .meter {
        display: inline-block;
        inline-size: calc(3 * var(--beuve-measure-em));
        block-size: var(--beuve-border-width-heavy);
        margin-inline-end: var(--beuve-space-1);
        overflow: hidden;
        border-radius: var(--beuve-radius-small);
        background: var(--beuve-border);
        vertical-align: middle;
      }

      .meter > span {
        display: block;
        block-size: 100%;
        background: var(--beuve-accent);
      }

      .save.unsaved {
        background: var(--beuve-accent-soft);
        color: var(--beuve-accent);
      }

      .save .check {
        margin-inline-end: var(--beuve-space-1);
        color: var(--beuve-ok);
      }
    `,
  ];

  private readonly onPopoverToggle = (event: Event): void => {
    const { newState, currentTarget } = event as ToggleEvent;
    if (newState !== 'open' || !(currentTarget instanceof HTMLElement)) {
      return;
    }
    this.emit('beuve-status-popover', { id: currentTarget.id });
  };

  /** The language servers beuve has started; absent until the first answer. */
  @property({ attribute: false }) accessor lspServers: readonly LspServerView[] | undefined;
  @property({ attribute: false }) accessor notice: StatusNotice | undefined;
  @property({ attribute: false }) accessor appInfo: AppInfo | undefined;
  /** How many of the shown files are marked reviewed (ADR 0064); absent without a review. */
  @property({ attribute: false }) accessor progress: FileReviewProgressView | undefined;
  /** The open review's range and saved progress, for the range menu (ADR 0142, 0157). */
  @property({ attribute: false }) accessor range: ReviewRangeView | undefined;
  /** What the diff shows (`describeReviewScope`); empty without a review. */
  @property() accessor scopeText = '';
  /** Whether the open review's head is saved (ADR 0157); absent without a review. */
  @property({ attribute: false }) accessor saveState: SaveState | undefined;
  @property({ attribute: false }) accessor githubAuth: GithubAuthStatusView | undefined;
  /** The open remote-branch session's branch (ADR 0112); absent for other sessions. */
  @property({ attribute: false }) accessor remoteBranch: RemoteBranchView | undefined;

  constructor() {
    super();
    this.addController(
      new ActionDelegation(this, {
        click: {
          'open-url': ({ url }, _event, element): void => {
            if (url === undefined) {
              return;
            }
            this.emit('beuve-status-open-url', { url });
            closePopoverOf(element);
          },
          'restart-servers': (_data, _event, element): void => {
            this.emit('beuve-status-action', { command: 'restart-language-servers' });
            closePopoverOf(element);
          },
          'save-action': ({ command }, _event, element): void => {
            if (command !== undefined) {
              this.emit('beuve-status-action', { command });
            }
            closePopoverOf(element);
          },
          'notice-action': ({ command }): void => {
            if (command !== undefined) {
              this.emit('beuve-status-action', { command });
            }
          },
        },
      }),
    );
  }

  private emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  private renderNotice(notice: StatusNotice): TemplateResult {
    const { action } = notice;
    return html`<span class="notice ${notice.tone}" role="status" title=${notice.text}
        >${notice.text}</span
      >${
        action === undefined
          ? nothing
          : html`<button
              type="button"
              class="button small notice-action"
              data-action="notice-action"
              data-command=${action.command}
            >
              ${action.label}
            </button>`
      }`;
  }

  private renderProgress(): TemplateResult | typeof nothing {
    const { progress } = this;
    const line = describeReviewProgress(progress);
    if (progress === undefined || line === undefined) {
      return nothing;
    }
    const share = `${String((100 * progress.reviewed) / progress.total)}%`;
    return html`<span title=${line.title}
      ><span class="meter" aria-hidden="true"
        ><span style=${styleMap({ 'inline-size': share })}></span></span
      >${progress.reviewed} of ${countNoun(progress.total, 'file')} reviewed</span
    >`;
  }

  /**
   * What the diff shows (ADR 0157): the range menu, named by the scope, once progress was saved;
   * before that, the scope as plain text.
   */
  private renderScope(): TemplateResult | typeof nothing {
    if (this.scopeText === '') {
      return nothing;
    }
    if ((this.range?.checkpoints.length ?? 0) === 0) {
      return html`<span class="scope" title="What the diff shows">${this.scopeText}</span>`;
    }
    return html`<beuve-review-range
      .range=${this.range}
      scopeText=${this.scopeText}
    ></beuve-review-range>`;
  }

  /** Saved or not, as a button whose popover offers Save Progress and Remove Last Saved Progress. */
  private renderSave(state: SaveState): TemplateResult {
    return html`<button
        type="button"
        class="button small quiet chip save ${state.kind}"
        popovertarget="save"
        title=${saveTitleOf(state)}
        aria-haspopup="dialog"
      >
        ${this.renderSaveLabel(state)}
      </button>
      <div
        id="save"
        popover
        class="start"
        role="dialog"
        aria-label="Saved progress"
        @toggle=${this.onPopoverToggle}
      >
        <p class="popover-title">Saved progress</p>
        <p class="popover-note">
          Copying or posting the review saves it. Next time, only what changes after the last save
          is shown.
        </p>
        <div class="popover-actions">
          <button
            class="button"
            type="button"
            data-action="save-action"
            data-command="undo-save-progress"
          >
            Remove Last Saved Progress
          </button>
          <button
            class="button primary"
            type="button"
            data-action="save-action"
            data-command="save-progress"
            ?disabled=${state.kind !== 'unsaved'}
          >
            Save Progress
          </button>
        </div>
      </div>`;
  }

  private renderSaveLabel(state: SaveState): TemplateResult {
    switch (state.kind) {
      case 'saving': {
        return html`Saving…`;
      }
      case 'saved': {
        return html`<span class="check" aria-hidden="true">✓</span>Saved at
          <beuve-commit sha=${state.sha}></beuve-commit>${
            state.at === undefined
              ? nothing
              : html` · <beuve-time datetime=${state.at} time-style="short"></beuve-time>`
          }`;
      }
      case 'unsaved': {
        return html`<span class="status-dot" data-tone="accent"></span>${
            state.since === undefined
              ? 'Not saved yet'
              : html`Unsaved since <beuve-commit sha=${state.since}></beuve-commit>`
          }`;
      }
    }
  }

  private renderLsp(): TemplateResult {
    const servers = this.lspServers ?? [];
    const line = describeLspStatus(servers);
    return html`<button
        type="button"
        class="button small quiet chip"
        popovertarget="lsp"
        title=${line.title}
        aria-haspopup="dialog"
      >
        <span class="status-dot" data-tone=${dotToneFrom(line.tone)}></span>${line.text}
      </button>
      <div
        id="lsp"
        popover
        class="start"
        role="dialog"
        aria-label="Language servers"
        @toggle=${this.onPopoverToggle}
      >
        <p class="popover-title">Language servers</p>
        ${
          servers.length === 0
            ? html`<p class="popover-note">
                None started yet. A server starts the first time a file needs one.
              </p>`
            : html`<ul class="rows">
                ${servers.map((server) => {
                  return this.renderServer(server);
                })}
              </ul>`
        }
        <div class="popover-actions">
          <button class="button" type="button" data-action="restart-servers">
            Restart language servers
          </button>
        </div>
      </div>`;
  }

  private renderServer(server: LspServerView): TemplateResult {
    const documents = `${String(server.openDocuments)} open`;
    let detail = documents;
    if (server.restarts > 0) {
      detail = `${documents} · restarted ${String(server.restarts)}×`;
    }
    return html`<li class="row">
      <span class="status-dot" data-tone=${dotToneFrom(server.state)}></span>
      <span>${server.serverId}</span>
      <span class="grow" title=${server.root}>${pathText(server.root)}</span>
      <span class="detail">${server.state} · ${detail}</span>
    </li>`;
  }

  /** The followed branch's state and, when its head commit names one, the agent session's link. */
  private renderRemoteBranch(branch: RemoteBranchView): TemplateResult {
    const line = describeRemoteBranch(branch);
    return html`<span title=${line.title}
        ><span class="status-dot" data-tone=${dotToneFrom(line.tone)}></span>${line.text}</span
      >
      ${
        branch.agentSessionUrl === undefined
          ? nothing
          : html`<button
              type="button"
              class="button link"
              data-action="open-url"
              data-url=${branch.agentSessionUrl}
              title=${branch.agentSessionUrl}
            >
              Agent session
            </button>`
      }`;
  }

  private renderGithub(auth: GithubAuthStatusView): TemplateResult {
    const line = describeGithubAuth(auth);
    return html`<span title=${line.title}
      ><span class="status-dot" data-tone=${dotToneFrom(line.tone)}></span>${line.text}</span
    >`;
  }

  override render(): TemplateResult {
    return html`
      ${this.renderProgress()} ${this.renderScope()}
      ${this.saveState === undefined ? nothing : this.renderSave(this.saveState)}
      ${this.renderLsp()} ${this.notice === undefined ? nothing : this.renderNotice(this.notice)}
      <span class="spacer"></span>
      ${this.remoteBranch === undefined ? nothing : this.renderRemoteBranch(this.remoteBranch)}
      ${this.githubAuth === undefined ? nothing : this.renderGithub(this.githubAuth)}
      ${this.appInfo === undefined ? nothing : html`<span>beuve ${this.appInfo.version}</span>`}
    `;
  }
}

/** The save button's tooltip, with what Save Progress would do. */
function saveTitleOf(state: SaveState): string {
  switch (state.kind) {
    case 'saving': {
      return 'Saving progress at the head';
    }
    case 'saved': {
      return `Progress saved at ${state.sha}: next time, only what changes after it is shown`;
    }
    case 'unsaved': {
      return 'Not saved at the head: Save Progress, or copy or post the review, to save it';
    }
  }
}

/** Closes the popover an action's element is in, once the action ran. */
function closePopoverOf(element: HTMLElement): void {
  element.closest<HTMLElement>('[popover]')?.hidePopover();
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-status-bar': BeuveStatusBar;
  }
}

/** The status dot tone (ADR 0115) for a describer's tone or a language server's state. */
function dotToneFrom(state: string): string {
  return dotTones[state] ?? state;
}
