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
/** A checkbox row: its label, the note beside it, its state, and the change it asks for. */
interface CheckRow {
  readonly label: string;
  readonly detail: string;
  readonly isOn: boolean;
  readonly change: (isOn: boolean) => SetDiffDisplayRequest;
}

/** One radio button: its group, its label, whether it is chosen, and the change it asks for. */
interface RadioChoice {
  readonly name: string;
  readonly label: string;
  readonly isOn: boolean;
  readonly change: SetDiffDisplayRequest;
}

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
    if (display.ok) {
      this.display = display.value;
    }
    if (editors.ok) {
      this.editors = editors.value;
    }
    if (trusted.ok) {
      this.trusted = trusted.value;
    }
    this.error =
      [display, editors, trusted]
        .map((result) => {
          if (result.ok) {
            return '';
          }
          return result.error.message;
        })
        .find((message) => message !== '') ?? '';
    const [github, claude] = await Promise.all([
      bridge.invoke('github:auth-status', {}),
      bridge.invoke('claude:status'),
    ]);
    this.github = undefined;
    if (github.ok) {
      this.github = github.value;
    }
    this.claude = undefined;
    if (claude.ok) {
      this.claude = claude.value;
    }
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
            ${(this.editors?.editors ?? []).map((editor) => {
              return html`<option
                value=${editor.id}
                ?selected=${editor.id === this.editors?.preferred}
              >
                ${editor.name}${editor.installed ? '' : ' (not found)'}
              </option>`;
            })}
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
            ${orders.map(([mode, label]) => {
              return html`<option
                value=${mode}
                ?selected=${(display.reviewOrder ?? 'path') === mode}
              >
                ${label}
              </option>`;
            })}
          </select>
        </div>
        ${this.renderCheck({
          label: 'Skip reviewed files',
          detail: 'In Next and Previous Change and File',
          isOn: display.skipReviewed === true,
          change: (isOn) => {
            return { skipReviewed: isOn };
          },
        })}
        <div class="row">
          <span>Open definitions in</span>
          <span class="choices">
            ${this.renderRadio({ name: 'sheets', label: 'Sheet windows', isOn: (display.sheets ?? 'window') === 'window', change: { sheets: 'window' } })}
            ${this.renderRadio({ name: 'sheets', label: 'Over the diff', isOn: display.sheets === 'inline', change: { sheets: 'inline' } })}
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
            ${this.renderRadio({ name: 'layout', label: 'Side by side', isOn: display.layout === 'split', change: { layout: 'split' } })}
            ${this.renderRadio({ name: 'layout', label: 'Inline', isOn: display.layout === 'unified', change: { layout: 'unified' } })}
          </span>
        </div>
        ${this.renderCheck({
          label: 'Hide whitespace changes',
          detail: 'Computed by git diff -w',
          isOn: display.ignoreWhitespace,
          change: (isOn) => {
            return { ignoreWhitespace: isOn };
          },
        })}
        ${this.renderCheck({
          label: 'Show generated files',
          detail: 'Expanded instead of collapsed',
          isOn: display.showGenerated,
          change: (isOn) => {
            return { showGenerated: isOn };
          },
        })}
        ${this.renderCheck({
          label: 'Show review insights',
          detail: 'Findings as notes on the diff lines',
          isOn: display.showInsights,
          change: (isOn) => {
            return { showInsights: isOn };
          },
        })}
      </div>
      <h2>Window</h2>
      <div class="group">
        <div class="row">
          <span>Sidebar</span>
          <span class="choices">
            ${this.renderRadio({ name: 'side', label: 'On the left', isOn: display.sidebarSide === 'left', change: { sidebarSide: 'left' } })}
            ${this.renderRadio({ name: 'side', label: 'On the right', isOn: display.sidebarSide === 'right', change: { sidebarSide: 'right' } })}
          </span>
        </div>
      </div>`;
  }

  private renderCheck({ label, detail, isOn, change }: CheckRow): TemplateResult {
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

  private renderRadio({ name, label, isOn, change }: RadioChoice): TemplateResult {
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
    return html`<h2>Accounts</h2>
      <div class="group">
        <div class="row" data-provider="github">
          <span>GitHub</span>
          <span>${this.renderGithub()}</span>
        </div>
        <div class="row" data-provider="claude">
          <span>Claude Code</span>
          <span>${this.renderClaude()}</span>
        </div>
      </div>`;
  }

  private renderGithub(): TemplateResult {
    if (this.github === undefined) {
      return renderChecking();
    }
    const github = describeGithubAuth(this.github);
    return html`<span class=${github.tone}>${github.text.replace(githubPrefix, '')}</span>
      <div class="detail">${github.title}</div>`;
  }

  private renderClaude(): TemplateResult {
    if (this.claude === undefined) {
      return renderChecking();
    }
    const claude = describeClaudeStatus(this.claude);
    return html`<span class=${claude.tone}>${claude.text}</span>
      <div class="detail">${claude.detail}</div>`;
  }

  private renderTrust(): TemplateResult {
    return html`<h2>Trusted repositories</h2>
      <div class="group">
        ${
          this.trusted.length === 0
            ? html`<p class="empty">
                No repository may run its tests for trace probes. Run Trace Probe asks first.
              </p>`
            : this.trusted.map((entry) => {
                return html`<div class="row trusted">
                  <span class="path" title=${entry.remoteUrl ?? ''}>${entry.repositoryPath}</span>
                  <span class="detail">since ${entry.trustedAt.slice(0, 10)}</span>
                  <button
                    type="button"
                    data-action="remove-trust"
                    data-path=${entry.repositoryPath}
                  >
                    Remove
                  </button>
                </div>`;
              })
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

/** An account row before its status has arrived. */
function renderChecking(): TemplateResult {
  return html`<span class="muted">Checking…</span>
    <div class="detail"></div>`;
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-settings-view': BeuveSettingsView;
  }
}
