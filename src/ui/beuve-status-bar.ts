import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { AppInfo, McpStatus } from '../contract/ipc-contract.ts';

/** Bottom bar: focused zone, MCP server state and app version. */
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

    .dot.failed {
      background: var(--beuve-danger);
    }

    kbd {
      font: var(--beuve-font-mono);
      font-size: 11px;
    }
  `;

  @property() accessor zoneLabel = '';
  @property({ attribute: false }) accessor mcpStatus: McpStatus | undefined;
  @property({ attribute: false }) accessor appInfo: AppInfo | undefined;

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
      <span>Focus: <span class="zone">${this.zoneLabel}</span></span>
      <span class="spacer"></span>
      ${this.renderMcp()}
      ${this.appInfo === undefined ? nothing : html`<span>beuve ${this.appInfo.version}</span>`}
      <span><kbd>?</kbd> keys</span>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-status-bar': BeuveStatusBar;
  }
}
