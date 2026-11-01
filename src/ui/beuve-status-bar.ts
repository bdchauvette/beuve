import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type {
  AppInfo,
  AttentionView,
  CiStatusView,
  GithubAuthStatusView,
  McpStatus,
} from '#contract/ipc-contract.ts';

import { describeAttention } from './describe-attention.ts';
import { describeCiStatus } from './describe-ci-status.ts';
import type { StatusNotice } from './describe-editor-open.ts';
import { describeGithubAuth } from './describe-github-auth.ts';

/**
 * Bottom bar: the focused region's name (keys live in the menus, ADR 0068), a transient notice, whose turn the open pull
 * request is (ADR 0066, reasons on hover), its CI rollup, GitHub
 * sign-in, MCP server state and app version.
 */
@customElement('beuve-status-bar')
export class BeuveStatusBar extends LitElement {
  static override styles = css`
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
    }

    .zone {
      color: var(--beuve-text);
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

    .dot.starting {
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
  `;

  @property() accessor zoneLabel = '';
  @property({ attribute: false }) accessor mcpStatus: McpStatus | undefined;
  @property({ attribute: false }) accessor notice: StatusNotice | undefined;
  @property({ attribute: false }) accessor appInfo: AppInfo | undefined;
  /** CI for the open pull request session's head; absent for local sessions. */
  @property({ attribute: false }) accessor ci: CiStatusView | undefined;
  @property({ attribute: false }) accessor githubAuth: GithubAuthStatusView | undefined;
  /** Whose turn the open pull request is; absent for local sessions and until it is known. */
  @property({ attribute: false }) accessor attention: AttentionView | undefined;
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
              @click=${(): void => {
                this.dispatchEvent(
                  new CustomEvent('beuve-status-action', {
                    detail: { command: action.command },
                    bubbles: true,
                    composed: true,
                  }),
                );
              }}
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

  private renderCi(ci: CiStatusView): TemplateResult {
    const line = describeCiStatus(ci);
    return html`<span title=${line.title}
      ><span class="dot ${line.tone}"></span>${line.text}</span
    >`;
  }

  private renderGithub(auth: GithubAuthStatusView): TemplateResult {
    const line = describeGithubAuth(auth);
    return html`<span title=${line.title}
      ><span class="dot ${line.tone}"></span>${line.text}</span
    >`;
  }

  private renderMcp(): TemplateResult {
    const status = this.mcpStatus;
    if (status === undefined) {
      return html`<span><span class="dot"></span>MCP: no bridge</span>`;
    }
    switch (status.state) {
      case 'running': {
        return html`<span title=${status.url}
          ><span class="dot running"></span>MCP ${status.url}</span
        >`;
      }
      case 'starting': {
        return html`<span><span class="dot starting"></span>MCP starting</span>`;
      }
      case 'stopped': {
        return html`<span><span class="dot"></span>MCP stopped</span>`;
      }
      case 'failed': {
        return html`<span title=${status.message}
          ><span class="dot failed"></span>MCP failed</span
        >`;
      }
    }
  }

  override render(): TemplateResult {
    return html`
      <span class="zone">${this.zoneLabel}</span>
      ${this.notice === undefined ? nothing : this.renderNotice(this.notice)}
      <span class="spacer"></span>
      ${this.renderAttention()} ${this.ci === undefined ? nothing : this.renderCi(this.ci)}
      ${this.githubAuth === undefined ? nothing : this.renderGithub(this.githubAuth)}
      ${this.renderMcp()}
      ${this.appInfo === undefined ? nothing : html`<span>beuve ${this.appInfo.version}</span>`}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-status-bar': BeuveStatusBar;
  }
}
