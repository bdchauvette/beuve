import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type {
  ClaudeStatusView,
  DiffDisplayView,
  EditorId,
  EditorSettingsView,
  GithubAuthStatusView,
  ReviewOrderMode,
  SetDiffDisplayRequest,
  SettingsApi,
  TraceTrustEntryView,
} from '#contract/ipc-contract.ts';

import './beuve-model-settings.ts';
import { ActionDelegation } from './action-delegation.ts';
import { describeClaudeStatus } from './describe-claude-status.ts';
import { describeGithubAuth } from './describe-github-auth.ts';

/**
 * The Settings window (ADR 0068): the preferences that were reachable only through chat commands
 * (editor, diff layout, whitespace, generated files, insights, review order, skipping reviewed
 * files, definitions, sidebar side), the accounts beuve uses (read-only), and the repositories
 * trusted to run their tests (each removable). Every change is saved at once through the settings
 * channels, which also tell the main window; the window is read again when it regains focus.
 */
@customElement('beuve-settings-view')
export class BeuveSettingsView extends LitElement {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
      overflow: auto;
      box-sizing: border-box;
      padding: var(--beuve-space-4) var(--beuve-space-6) var(--beuve-space-6);
      background: var(--beuve-bg);
      color: var(--beuve-text);
      font: var(--beuve-font-body);
    }

    h2 {
      margin: var(--beuve-space-4) 0 var(--beuve-space-2);
      font: var(--beuve-font-small);
      font-weight: 600;
      color: var(--beuve-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    h2:first-child {
      margin-top: 0;
    }

    .group {
      border: 1px solid var(--beuve-border);
      border-radius: var(--beuve-radius);
      background: var(--beuve-surface);
    }

    .row {
      display: grid;
      grid-template-columns: 180px minmax(0, 1fr);
      align-items: center;
      gap: var(--beuve-space-3);
      min-height: 32px;
      padding: var(--beuve-space-1) var(--beuve-space-3);
    }

    .row + .row {
      border-top: 1px solid var(--beuve-border);
    }

    .row > label:first-child,
    .row > span:first-child {
      color: var(--beuve-text);
    }

    .detail {
      font: var(--beuve-font-small);
      color: var(--beuve-text-muted);
      overflow-wrap: anywhere;
    }

    .ok {
      color: var(--beuve-ok);
    }

    .warn {
      color: var(--beuve-warn);
    }

    .muted {
      color: var(--beuve-text-muted);
    }

    select,
    button {
      font: inherit;
      color: var(--beuve-text);
    }

    select {
      justify-self: start;
      min-width: 160px;
    }

    .choices {
      display: flex;
      flex-wrap: wrap;
      gap: var(--beuve-space-3);
    }

    .trusted {
      display: flex;
      align-items: center;
      gap: var(--beuve-space-2);
    }

    .trusted .path {
      flex: 1;
      min-width: 0;
      overflow-wrap: anywhere;
      font: var(--beuve-font-mono);
    }

    .empty {
      padding: var(--beuve-space-2) var(--beuve-space-3);
      color: var(--beuve-text-muted);
    }

    .error {
      margin: var(--beuve-space-3) 0 0;
      color: var(--beuve-danger);
    }
  `;

  private readonly onWindowFocus = (): void => {
    void this.load();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.defaultPrevented) {
      return;
    }

    event.preventDefault();
    close();
  };

  @property({ attribute: false }) accessor api: SettingsApi | undefined;

  @state() accessor display: DiffDisplayView | undefined;
  @state() accessor editors: EditorSettingsView | undefined;
  @state() accessor github: GithubAuthStatusView | undefined;
  @state() accessor claude: ClaudeStatusView | undefined;
  @state() accessor trusted: readonly TraceTrustEntryView[] = [];
  @state() accessor error = '';

  constructor() {
    super();
    // ADR 0074: the trusted repositories' Remove buttons, through one listener.
    this.addController(
      new ActionDelegation(this, {
        click: {
          'remove-trust': ({ path = '' }): void => {
            void this.removeTrust(path);
          },
        },
      }),
    );
  }

  /** Reads every setting and account afresh. */
  private async load(): Promise<void> {
    const { api: bridge } = this;
    if (bridge === undefined) {
      this.error = 'This window has no connection to beuve.';
      return;
    }
    const [display, editors, trusted] = await Promise.all([
      bridge.invoke('display:get'),
      bridge.invoke('editor:get-settings'),
      bridge.invoke('trace:list-trust'),
    ]);
    this.display = display.ok ? display.value : this.display;
    this.editors = editors.ok ? editors.value : this.editors;
    this.trusted = trusted.ok ? trusted.value : this.trusted;
    this.error =
      [display, editors, trusted]
        .map((result) => (result.ok ? '' : result.error.message))
        .find((message) => message !== '') ?? '';
    const [github, claude] = await Promise.all([
      bridge.invoke('github:auth-status', {}),
      bridge.invoke('claude:status'),
    ]);
    this.github = github.ok ? github.value : undefined;
    this.claude = claude.ok ? claude.value : undefined;
  }

  private async setDisplay(change: SetDiffDisplayRequest): Promise<void> {
    const { api: bridge } = this;
    if (bridge === undefined) {
      return;
    }
    const saved = await bridge.invoke('display:set', change);
    if (saved.ok) {
      this.display = saved.value;
      this.error = '';
    } else {
      this.error = saved.error.message;
    }
  }

  private async setEditor(editorId: EditorId): Promise<void> {
    const { api: bridge } = this;
    if (bridge === undefined) {
      return;
    }
    const saved = await bridge.invoke('editor:set-preferred', { editorId });
    if (saved.ok) {
      this.editors = saved.value;
    } else {
      this.error = saved.error.message;
    }
  }

  private async removeTrust(repositoryPath: string): Promise<void> {
    const { api: bridge } = this;
    if (bridge === undefined) {
      return;
    }
    const left = await bridge.invoke('trace:remove-trust', { repositoryPath });
    if (left.ok) {
      this.trusted = left.value;
    } else {
      this.error = left.error.message;
    }
  }

  private renderReview(display: DiffDisplayView): TemplateResult {
    return html`<h2>Review</h2>
      <div class="group">
        <div class="row">
          <label for="editor">Open in Editor uses</label>
          <select
            id="editor"
            @change=${(event: Event): void => {
              void this.setEditor((event.target as HTMLSelectElement).value as EditorId);
            }}
          >
            ${
              this.editors?.preferred === undefined
                ? html`<option value="" selected disabled>The first one installed</option>`
                : nothing
            }
            ${(this.editors?.editors ?? []).map(
              (editor) =>
                html`<option value=${editor.id} ?selected=${editor.id === this.editors?.preferred}>
                  ${editor.name}${editor.installed ? '' : ' (not found)'}
                </option>`,
            )}
          </select>
        </div>
        <div class="row">
          <label for="order">Order files by</label>
          <select
            id="order"
            @change=${(event: Event): void => {
              void this.setDisplay({
                reviewOrder: (event.target as HTMLSelectElement).value as ReviewOrderMode,
              });
            }}
          >
            ${orders.map(
              ([mode, label]) =>
                html`<option value=${mode} ?selected=${(display.reviewOrder ?? 'path') === mode}>
                  ${label}
                </option>`,
            )}
          </select>
        </div>
        ${this.renderCheck('Skip reviewed files', 'In Next and Previous Change and File', display.skipReviewed === true, (isOn) => ({ skipReviewed: isOn }))}
        <div class="row">
          <span>Open definitions in</span>
          <span class="choices">
            ${this.renderRadio('sheets', 'Sheet windows', (display.sheets ?? 'window') === 'window', { sheets: 'window' })}
            ${this.renderRadio('sheets', 'Over the diff', display.sheets === 'inline', { sheets: 'inline' })}
          </span>
        </div>
      </div>`;
  }

  private renderDiff(display: DiffDisplayView): TemplateResult {
    return html`<h2>Diff</h2>
      <div class="group">
        <div class="row">
          <span>Show changes</span>
          <span class="choices">
            ${this.renderRadio('layout', 'Side by side', display.layout === 'split', { layout: 'split' })}
            ${this.renderRadio('layout', 'Inline', display.layout === 'unified', { layout: 'unified' })}
          </span>
        </div>
        ${this.renderCheck('Hide whitespace changes', 'Computed by git diff -w', display.ignoreWhitespace, (isOn) => ({ ignoreWhitespace: isOn }))}
        ${this.renderCheck('Show generated files', 'Expanded instead of collapsed', display.showGenerated, (isOn) => ({ showGenerated: isOn }))}
        ${this.renderCheck('Show review insights', 'Findings as notes on the diff lines', display.showInsights, (isOn) => ({ showInsights: isOn }))}
      </div>
      <h2>Window</h2>
      <div class="group">
        <div class="row">
          <span>Sidebar</span>
          <span class="choices">
            ${this.renderRadio('side', 'On the left', display.sidebarSide === 'left', { sidebarSide: 'left' })}
            ${this.renderRadio('side', 'On the right', display.sidebarSide === 'right', { sidebarSide: 'right' })}
          </span>
        </div>
      </div>`;
  }

  private renderCheck(
    label: string,
    detail: string,
    isOn: boolean,
    change: (isOn: boolean) => SetDiffDisplayRequest,
  ): TemplateResult {
    return html`<div class="row">
      <label>
        <input
          type="checkbox"
          .checked=${isOn}
          @change=${(event: Event): void => {
            void this.setDisplay(change((event.target as HTMLInputElement).checked));
          }}
        />
        ${label}
      </label>
      <span class="detail">${detail}</span>
    </div>`;
  }

  private renderRadio(
    name: string,
    label: string,
    isOn: boolean,
    change: SetDiffDisplayRequest,
  ): TemplateResult {
    return html`<label>
      <input
        type="radio"
        name=${name}
        .checked=${isOn}
        @change=${(): void => {
          void this.setDisplay(change);
        }}
      />
      ${label}
    </label>`;
  }

  /**
   * One row per provider, read-only. API keys for models are entered write-only under Models
   * (ADR 0070); main stores them with `safeStorage` and never sends them back to this page.
   */
  private renderAccounts(): TemplateResult {
    const github = this.github === undefined ? undefined : describeGithubAuth(this.github);
    const claude = this.claude === undefined ? undefined : describeClaudeStatus(this.claude);
    return html`<h2>Accounts</h2>
      <div class="group">
        <div class="row" data-provider="github">
          <span>GitHub</span>
          <span>
            <span class=${github?.tone ?? 'muted'}
              >${github === undefined ? 'Checking…' : github.text.replace(githubPrefix, '')}</span
            >
            <div class="detail">${github?.title ?? ''}</div>
          </span>
        </div>
        <div class="row" data-provider="claude">
          <span>Claude Code</span>
          <span>
            <span class=${claude?.tone ?? 'muted'}>${claude?.text ?? 'Checking…'}</span>
            <div class="detail">${claude?.detail ?? ''}</div>
          </span>
        </div>
      </div>`;
  }

  private renderTrust(): TemplateResult {
    return html`<h2>Trusted repositories</h2>
      <div class="group">
        ${
          this.trusted.length === 0
            ? html`<p class="empty">
                No repository may run its tests for trace probes. Run Trace Probe asks first.
              </p>`
            : this.trusted.map(
                (entry) =>
                  html`<div class="row trusted">
                    <span class="path" title=${entry.remoteUrl ?? ''}>${entry.repositoryPath}</span>
                    <span class="detail">since ${entry.trustedAt.slice(0, 10)}</span>
                    <button
                      type="button"
                      data-action="remove-trust"
                      data-path=${entry.repositoryPath}
                    >
                      Remove
                    </button>
                  </div>`,
              )
        }
      </div>`;
  }

  override connectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.connectedCallback();
    addEventListener('focus', this.onWindowFocus);
    addEventListener('keydown', this.onKeyDown);
    void this.load();
  }

  override disconnectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.disconnectedCallback();
    removeEventListener('focus', this.onWindowFocus);
    removeEventListener('keydown', this.onKeyDown);
  }

  override render(): TemplateResult {
    const { display } = this;
    return html`
      ${display === undefined ? nothing : html`${this.renderReview(display)} ${this.renderDiff(display)}`}
      ${this.renderAccounts()}
      <beuve-model-settings .api=${this.api}></beuve-model-settings>
      ${this.renderTrust()}
      ${this.error === '' ? nothing : html`<p class="error" role="alert">${this.error}</p>`}
    `;
  }
}

const githubPrefix = /^GitHub: /u;

const orders: readonly (readonly [ReviewOrderMode, string])[] = [
  ['path', 'Path'],
  ['imports', 'Imports (what a file uses comes first)'],
  ['calls', 'Calls (asks the language server)'],
];

declare global {
  interface HTMLElementTagNameMap {
    'beuve-settings-view': BeuveSettingsView;
  }
}
