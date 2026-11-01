import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { DependencyLogView, DependencyStatusView, TrustView } from '#contract/ipc-contract.ts';

import { ActionDelegation } from './action-delegation.ts';
import { formatControlStyles } from './format-control-styles.ts';
import { pathText } from './path-text.ts';
import { revealLogText } from './reveal-log-text.ts';
import { trustGrantWording } from './trust-grant-wording.ts';

/** What the dependency dialog shows. */
export type DependencyDialogState =
  /** The one trust grant's prompt (ADR 0090), for the session's repository. */
  | { readonly kind: 'trust'; readonly trust: TrustView }
  /** The lockfile safeguard's question, with the changed dependency inputs. */
  | { readonly kind: 'safeguard'; readonly status: DependencyStatusView }
  /** The checkout's install log; `undefined` while it loads. */
  | { readonly kind: 'log'; readonly log: DependencyLogView | undefined; readonly error?: string };

/** What the reviewer chose in the dialog. */
export interface DependencyDialogChoice {
  readonly action: 'trust' | 'install' | 'skip' | 'close' | 'file' | 'refresh';
  /** For `file`: the repository-relative path to show in the diff. */
  readonly path?: string;
}

/**
 * The trust prompt, the safeguard's question and the install log (ADR 0089, 0090), as one
 * modal panel. Focus starts on Cancel (ADR 0041); Escape closes it. Choices leave as
 * `beuve-dependency-choice` events; paths and log text are revealed (ADR 0082).
 */
@customElement('beuve-dependency-dialog')
export class BeuveDependencyDialog extends LitElement {
  static override styles = [
    formatControlStyles,
    css`
      :host {
        display: block;
        color: var(--beuve-text);
        font: var(--beuve-font-body, inherit);
      }

      h3 {
        margin: 0 0 var(--beuve-space-3);
        font-size: 1.05em;
      }

      p {
        margin: 0 0 var(--beuve-space-3);
        line-height: 1.45;
      }

      code {
        font: var(--beuve-font-mono, monospace);
      }

      ul {
        margin: 0 0 var(--beuve-space-3);
        padding-left: var(--beuve-space-4);
      }

      .link {
        padding: 0;
        border: 0;
        background: none;
        color: var(--beuve-accent);
        font: var(--beuve-font-mono, monospace);
        text-decoration: underline;
        cursor: pointer;
      }

      pre {
        max-height: 60vh;
        margin: 0 0 var(--beuve-space-3);
        padding: var(--beuve-space-3);
        overflow: auto;
        border: 1px solid var(--beuve-border);
        border-radius: 6px;
        background: var(--beuve-surface-sunken);
        font: var(--beuve-font-mono, monospace);
        font-size: 12px;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--beuve-space-2);
      }

      .actions button {
        padding: var(--beuve-space-1) var(--beuve-space-3);
        border: 1px solid var(--beuve-border);
        border-radius: 6px;
        background: var(--beuve-surface);
        color: var(--beuve-text);
        font: inherit;
        cursor: pointer;
      }

      .actions button.primary {
        border-color: var(--beuve-accent);
        background: var(--beuve-accent);
        color: var(--beuve-on-accent, #fff);
      }

      .muted {
        color: var(--beuve-text-muted);
      }
    `,
  ];

  @property({ attribute: false }) accessor state: DependencyDialogState | undefined;

  constructor() {
    super();
    // ADR 0074: every button, the file links included, through one listener.
    this.addController(
      new ActionDelegation(this, {
        click: {
          choose: ({ choice = 'close', path }): void => {
            this.choose({ action: choiceOf(choice), ...(path !== undefined && { path }) });
          },
        },
        keydown: {
          dialog: (_data, event): void => {
            if (event.key !== 'Escape') {
              return;
            }
            event.preventDefault();
            this.choose({ action: 'close' });
          },
        },
      }),
    );
  }

  private choose(choice: DependencyDialogChoice): void {
    this.dispatchEvent(
      new CustomEvent('beuve-dependency-choice', { detail: choice, bubbles: true, composed: true }),
    );
  }

  private renderTrust(trust: TrustView): TemplateResult {
    return html`<h3 id="dependency-title">Trust this repository?</h3>
      <p>
        <code title=${trust.repositoryPath}>${pathText(trust.repositoryPath)}</code>${
          trust.remoteUrl === undefined
            ? nothing
            : html` · origin <code title=${trust.remoteUrl}>${pathText(trust.remoteUrl)}</code>`
        }
      </p>
      <p>${trustGrantWording}</p>
      <p class="muted">
        When the commits under review change a lockfile, a manifest or package-manager settings,
        beuve still asks before installing (Settings can turn that off for this repository).
      </p>
      <div class="actions">
        <button type="button" data-action="choose" data-choice="close" data-cancel>Cancel</button>
        <button type="button" class="primary" data-action="choose" data-choice="trust">
          Trust
        </button>
      </div>`;
  }

  private renderSafeguard(status: DependencyStatusView): TemplateResult {
    return html`<h3 id="dependency-title">Dependencies changed</h3>
      <p>This change modifies dependencies:</p>
      <ul>
        ${status.inputs.map((input) => {
          return html`<li>
            <button
              type="button"
              class="link"
              title=${input}
              data-action="choose"
              data-choice="file"
              data-path=${input}
            >
              ${pathText(input)}
            </button>
          </li>`;
        })}
      </ul>
      <p>Install and run their scripts?</p>
      <div class="actions">
        <button type="button" data-action="choose" data-choice="close" data-cancel>Cancel</button>
        <button type="button" data-action="choose" data-choice="skip">Skip</button>
        <button type="button" class="primary" data-action="choose" data-choice="install">
          Install
        </button>
      </div>`;
  }

  private renderLog(log: DependencyLogView | undefined, error: string | undefined): TemplateResult {
    let body: TemplateResult;
    if (error !== undefined) {
      body = html`<p>${error}</p>`;
    } else if (log === undefined) {
      body = html`<p class="muted">Reading the log…</p>`;
    } else {
      body = html`${
          log.truncated ? html`<p class="muted">The log is long; this is its end.</p>` : nothing
        }
        <pre aria-label="Install log">${revealLogText(log.text)}</pre>`;
    }
    return html`<h3 id="dependency-title">Install log</h3>
      ${body}
      <div class="actions">
        <button type="button" data-action="choose" data-choice="refresh">Refresh</button>
        <button type="button" data-action="choose" data-choice="close" data-cancel>Close</button>
      </div>`;
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has('state')) {
      this.renderRoot.querySelector<HTMLButtonElement>('[data-cancel]')?.focus();
    }
  }

  override render(): TemplateResult | typeof nothing {
    const { state } = this;
    if (state === undefined) {
      return nothing;
    }
    let content: TemplateResult;
    switch (state.kind) {
      case 'trust': {
        content = this.renderTrust(state.trust);
        break;
      }
      case 'safeguard': {
        content = this.renderSafeguard(state.status);
        break;
      }
      case 'log': {
        content = this.renderLog(state.log, state.error);
        break;
      }
    }
    return html`<div role="dialog" aria-labelledby="dependency-title" data-action="dialog">
      ${content}
    </div>`;
  }
}

function choiceOf(value: string): DependencyDialogChoice['action'] {
  switch (value) {
    case 'trust':
    case 'install':
    case 'skip':
    case 'file':
    case 'refresh': {
      return value;
    }
    default: {
      return 'close';
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-dependency-dialog': BeuveDependencyDialog;
  }
}
