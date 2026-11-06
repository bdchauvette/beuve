import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type {
  AppInfo,
  AttentionView,
  CiCheckView,
  CiStatusView,
  GithubAuthStatusView,
  LspServerView,
  RemoteBranchView,
} from '#contract/ipc-contract.ts';

import { ActionDelegation } from './action-delegation.ts';
import { describeAttention } from './describe-attention.ts';
import { describeCiStatus } from './describe-ci-status.ts';
import type { StatusNotice } from './describe-editor-open.ts';
import { describeGithubAuth } from './describe-github-auth.ts';
import { describeLspStatus } from './describe-lsp-status.ts';
import { describeRemoteBranch } from './describe-remote-branch.ts';
import { formatControlStyles } from './format-control-styles.ts';
import { pathText } from './path-text.ts';

/** `beuve-status-open-url`: a link in a status popover, for the owner to open. */
export interface StatusOpenUrlDetail {
  readonly url: string;
}

/** `beuve-status-popover`: which popover (`lsp` or `ci`) just opened. */
export interface StatusPopoverDetail {
  readonly id: string;
}

/** Worst first, so a failing check is at the top of the list. */
const bucketRank: Readonly<Record<CiCheckView['bucket'], number>> = {
  failure: 0,
  pending: 1,
  success: 2,
  neutral: 3,
};

const bucketTone: Readonly<Record<CiCheckView['bucket'], string>> = {
  failure: 'danger',
  pending: 'warn',
  success: 'ok',
  neutral: '',
};

/**
 * Bottom bar: the language servers (click for each one's state), a transient notice, whose turn
 * the open pull request is (ADR 0066, reasons on hover), its CI rollup (click for the checks, each
 * a link to its run), GitHub sign-in and app version. Its text is not selectable:
 * these are controls and readouts, not content.
 *
 * Emits `beuve-status-action` (a catalog command), `beuve-status-open-url` (a link in a popover)
 * and `beuve-status-popover` when a popover opens, so the owner can refresh what it shows.
 */
@customElement('beuve-status-bar')
export class BeuveStatusBar extends LitElement {
  static override styles = [
    formatControlStyles,
    css`
      :host {
        display: flex;
        align-items: center;
        gap: var(--beuve-space-4);
        padding: 0 var(--beuve-space-3);
        border-top: 1px solid var(--beuve-border);
        background: var(--beuve-surface-sunken);
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
        white-space: nowrap;
        user-select: none;
        -webkit-user-select: none;
      }

      .chip {
        display: inline-flex;
        align-items: center;
        padding: 0 var(--beuve-space-1);
        border: 0;
        border-radius: var(--beuve-radius-small, 3px);
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }

      .chip:hover,
      .chip:has(+ [popover]:popover-open) {
        background: var(--beuve-surface-hover, var(--beuve-surface));
        color: var(--beuve-text);
      }

      [popover] {
        position: fixed;
        inset: auto;
        bottom: calc(var(--beuve-statusbar-height) + var(--beuve-space-1));
        min-width: 260px;
        max-width: min(560px, calc(100vw - 2 * var(--beuve-space-3)));
        max-height: 50vh;
        margin: 0;
        padding: var(--beuve-space-2) var(--beuve-space-3);
        overflow: auto;
        border: 1px solid var(--beuve-border);
        border-radius: var(--beuve-radius);
        background: var(--beuve-surface);
        box-shadow: 0 4px 16px rgb(0 0 0 / 25%);
        color: var(--beuve-text);
        white-space: normal;
      }

      [popover].start {
        left: var(--beuve-space-3);
      }

      [popover].end {
        right: var(--beuve-space-3);
      }

      .popover-title {
        margin: 0 0 var(--beuve-space-2);
        color: var(--beuve-text-muted);
        font-weight: 600;
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
        margin-left: auto;
        padding-left: var(--beuve-space-3);
        color: var(--beuve-text-muted);
        white-space: nowrap;
      }

      .row .grow {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .link {
        padding: 0;
        border: 0;
        background: none;
        color: var(--beuve-accent);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }

      .link:hover {
        text-decoration: underline;
      }

      .popover-actions {
        display: flex;
        justify-content: flex-end;
        margin-top: var(--beuve-space-2);
      }

      .notice {
        user-select: text;
        -webkit-user-select: text;
      }

      .spacer {
        flex: 1;
      }

      .dot {
        display: inline-block;
        width: 7px;
        height: 7px;
        margin-right: var(--beuve-space-1);
        border-radius: 50%;
        background: var(--beuve-text-muted);
      }

      .dot.running {
        background: var(--beuve-ok);
      }

      .dot.starting,
      .dot.stopping {
        background: var(--beuve-warn);
      }

      .dot.failed,
      .dot.danger {
        background: var(--beuve-danger);
      }

      .dot.ok {
        background: var(--beuve-ok);
      }

      .dot.warn {
        background: var(--beuve-warn);
      }

      .dot.busy {
        background: var(--beuve-accent);
      }

      .notice {
        overflow: hidden;
        text-overflow: ellipsis;
        color: var(--beuve-text);
      }

      .notice.error {
        color: var(--beuve-danger);
      }

      .attention {
        cursor: default;
      }

      button {
        flex: none;
        padding: 0 var(--beuve-space-2);
        border: 1px solid var(--beuve-border);
        border-radius: var(--beuve-radius-small, 3px);
        background: transparent;
        color: var(--beuve-text);
        font: inherit;
        cursor: pointer;
      }

      button:hover {
        background: var(--beuve-surface-hover, var(--beuve-surface));
      }

      .attention.yours {
        color: var(--beuve-accent);
        font-weight: 600;
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
  /** CI for the open pull request session's head; absent for local sessions. */
  @property({ attribute: false }) accessor ci: CiStatusView | undefined;
  @property({ attribute: false }) accessor githubAuth: GithubAuthStatusView | undefined;
  /** Whose turn the open pull request is; absent for local sessions and until it is known. */
  @property({ attribute: false }) accessor attention: AttentionView | undefined;
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
              class="notice-action"
              data-action="notice-action"
              data-command=${action.command}
            >
              ${action.label}
            </button>`
      }`;
  }

  private renderAttention(): TemplateResult | typeof nothing {
    const chip = describeAttention(this.attention);
    if (chip === undefined) {
      return nothing;
    }
    return html`<span class="attention ${chip.isYours ? 'yours' : ''}" title=${chip.title}
      >${chip.text}</span
    >`;
  }

  private renderLsp(): TemplateResult {
    const servers = this.lspServers ?? [];
    const line = describeLspStatus(servers);
    return html`<button
        type="button"
        class="chip"
        popovertarget="lsp"
        title=${line.title}
        aria-haspopup="dialog"
      >
        <span class="dot ${line.tone}"></span>${line.text}
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
          <button type="button" data-action="restart-servers">Restart language servers</button>
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
      <span class="dot ${server.state}"></span>
      <span>${server.serverId}</span>
      <span class="grow" title=${server.root}>${pathText(server.root)}</span>
      <span class="detail">${server.state} · ${detail}</span>
    </li>`;
  }

  private renderCi(ci: CiStatusView): TemplateResult {
    const line = describeCiStatus(ci);
    const checks = ci.checks.toSorted((a, b) => {
      return bucketRank[a.bucket] - bucketRank[b.bucket];
    });
    return html`<button
        type="button"
        class="chip"
        popovertarget="ci"
        title=${line.title}
        aria-haspopup="dialog"
      >
        <span class="dot ${line.tone}"></span>${line.text}
      </button>
      <div
        id="ci"
        popover
        class="end"
        role="dialog"
        aria-label="CI checks"
        @toggle=${this.onPopoverToggle}
      >
        <p class="popover-title">Checks on ${ci.sha.slice(0, 7)}</p>
        ${
          checks.length === 0
            ? html`<p class="popover-note">No checks have reported for this commit.</p>`
            : html`<ul class="rows">
                ${checks.map((check) => {
                  return this.renderCheck(check);
                })}
              </ul>`
        }
        ${
          ci.isTruncated
            ? html`<p class="popover-note">More checks exist than were fetched.</p>`
            : nothing
        }
      </div>`;
  }

  private renderCheck(check: CiCheckView): TemplateResult {
    return html`<li class="row">
      <span class="dot ${bucketTone[check.bucket]}"></span>
      ${
        check.url === undefined
          ? html`<span class="grow" title=${check.name}>${check.name}</span>`
          : html`<button
              type="button"
              class="link grow"
              title=${`Open ${check.name} on GitHub`}
              data-action="open-url"
              data-url=${check.url}
            >
              ${check.name}
            </button>`
      }
      <span class="detail">${check.bucket}</span>
    </li>`;
  }

  /** The followed branch's state and, when its head commit names one, the agent session's link. */
  private renderRemoteBranch(branch: RemoteBranchView): TemplateResult {
    const line = describeRemoteBranch(branch);
    return html`<span title=${line.title}><span class="dot ${line.tone}"></span>${line.text}</span>
      ${
        branch.agentSessionUrl === undefined
          ? nothing
          : html`<button
              type="button"
              class="link"
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
      ><span class="dot ${line.tone}"></span>${line.text}</span
    >`;
  }

  override render(): TemplateResult {
    return html`
      ${this.renderLsp()} ${this.notice === undefined ? nothing : this.renderNotice(this.notice)}
      <span class="spacer"></span>
      ${this.remoteBranch === undefined ? nothing : this.renderRemoteBranch(this.remoteBranch)}
      ${this.renderAttention()} ${this.ci === undefined ? nothing : this.renderCi(this.ci)}
      ${this.githubAuth === undefined ? nothing : this.renderGithub(this.githubAuth)}
      ${this.appInfo === undefined ? nothing : html`<span>beuve ${this.appInfo.version}</span>`}
    `;
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
