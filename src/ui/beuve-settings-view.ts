import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type {
  ClaudeStatusView,
  DiffDisplayView,
  EditorSettingsView,
  GithubAuthStatusView,
  SetDiffDisplayRequest,
  SettingsApi,
} from '#contract/ipc-contract.ts';

import { applyFonts } from './apply-fonts.ts';
import './beuve-model-settings.ts';
import { describeOpenedConfig } from './describe-opened-config.ts';
import { describeClaudeStatus } from './describe-claude-status.ts';
import { describeGithubAuth } from './describe-github-auth.ts';
import { formatControlStyles } from './format-control-styles.ts';
import { buttonStyles } from './primitives/button-styles.ts';
import { emptyStateStyles } from './primitives/empty-state-styles.ts';

/**
 * The Settings window (ADR 0068): only what no menu item sets (the review-edits and review-queue
 * branch prefixes, the code font, the language server configuration, the models), and the accounts beuve uses
 * (read-only). Every toggle the menus have lives only there. Every change is saved at once through the
 * settings channels, which also tell the main window; the window is read again when it regains
 * focus.
 */
@customElement('beuve-settings-view')
export class BeuveSettingsView extends LitElement {
  static override styles = [
    emptyStateStyles,
    buttonStyles,
    formatControlStyles,
    css`
      :host {
        display: block;
        block-size: 100%;
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
        font-weight: var(--beuve-font-weight-semibold);
        color: var(--beuve-text-muted);
        text-transform: uppercase;
        letter-spacing: var(--beuve-letter-spacing-caps);
      }

      h2:first-child {
        margin-block-start: 0;
      }

      .group {
        border: var(--beuve-border-width) solid var(--beuve-border);
        border-radius: var(--beuve-radius);
        background: var(--beuve-surface);
      }

      .row {
        display: grid;
        grid-template-columns: var(--beuve-size-label) minmax(0, 1fr);
        align-items: center;
        gap: var(--beuve-space-3);
        min-block-size: var(--beuve-size-row);
        padding: var(--beuve-space-1) var(--beuve-space-3);
      }

      .row + .row {
        border-block-start: var(--beuve-border-width) solid var(--beuve-border);
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

      input[type='text'] {
        justify-self: start;
        min-inline-size: var(--beuve-size-field);
      }

      input[type='text'] {
        font: var(--beuve-font-code);
        color: var(--beuve-text);
      }

      .empty {
        padding: var(--beuve-space-2) var(--beuve-space-3);
      }

      .error {
        margin: var(--beuve-space-3) 0 0;
        color: var(--beuve-danger);
      }
    `,
  ];

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
  @state() accessor error = '';
  /** What opening the language server configuration did last, for the row's detail line. */
  @state() accessor languageServersNote = '';

  /** Reads every setting and account afresh. */
  private async load(): Promise<void> {
    const { api: bridge } = this;
    if (bridge === undefined) {
      this.error = 'This window has no connection to beuve.';
      return;
    }
    const [display, editors] = await Promise.all([
      bridge.invoke('display:get'),
      bridge.invoke('editor:get-settings'),
    ]);
    if (display.ok) {
      this.display = display.value;
      applyFonts(display.value);
    }
    if (editors.ok) {
      this.editors = editors.value;
    }
    this.error =
      [display, editors]
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
      applyFonts(saved.value);
      this.error = '';
    } else {
      this.error = saved.error.message;
    }
  }

  /** Opens `language-servers.json` in the reviewer's editor, creating an empty one if there is none (ADR 0111). */
  private async openLanguageServers(): Promise<void> {
    const { api: bridge } = this;
    if (bridge === undefined) {
      return;
    }
    const opened = await bridge.invoke('language-servers:open-config');
    if (opened.ok) {
      this.error = '';
      this.languageServersNote = describeOpenedConfig(opened.value);
    } else {
      this.error = opened.error.message;
    }
  }

  private async setReviewEditsPrefix(prefix: string): Promise<void> {
    const { api: bridge } = this;
    if (bridge === undefined) {
      return;
    }
    const saved = await bridge.invoke('editor:set-review-edits-prefix', { prefix });
    if (saved.ok) {
      this.editors = saved.value;
      this.error = '';
    } else {
      this.error = saved.error.message;
    }
  }

  private renderBranches(display: DiffDisplayView): TemplateResult {
    return html`<h2>Branches</h2>
      <div class="group">
        <div class="row">
          <label
            for="review-edits-prefix"
            title="Open Review Edits makes a local branch named after it, such as review/pr-12; beuve never pushes it."
          >
            Review edits branches start with
          </label>
          <input
            id="review-edits-prefix"
            type="text"
            spellcheck="false"
            .value=${this.editors?.reviewEditsPrefix ?? 'review/'}
            @change=${(event: Event): void => {
              void this.setReviewEditsPrefix((event.target as HTMLInputElement).value.trim());
            }}
          />
        </div>
        <div class="row">
          <label
            for="queue-prefixes"
            title="The review queue lists branches with these prefixes and no pull request, in repositories you opened before. Separate prefixes with commas; leave empty to list none."
          >
            Review queue lists branches starting with
          </label>
          <input
            id="queue-prefixes"
            type="text"
            spellcheck="false"
            .value=${(display.reviewQueueBranchPrefixes ?? ['claude/']).join(', ')}
            @change=${(event: Event): void => {
              void this.setDisplay({
                reviewQueueBranchPrefixes: prefixesFrom((event.target as HTMLInputElement).value),
              });
            }}
          />
        </div>
      </div>`;
  }

  /**
   * The preferred code font (ADR 0122) and prose font for rendered files (ADR 0124): `font-family`
   * lists, empty for Commit Mono and IBM Plex Sans. The interface uses the system font.
   */
  private renderFonts(display: DiffDisplayView): TemplateResult {
    return html`<h2>Fonts</h2>
      <div class="group">
        <div class="row">
          <label
            for="code-font"
            title='A font-family list, such as "JetBrains Mono", monospace. Commit Mono and the system fonts stay as fallbacks.'
          >
            Code font
          </label>
          <input
            id="code-font"
            type="text"
            spellcheck="false"
            placeholder="Commit Mono"
            .value=${display.codeFont ?? ''}
            @change=${(event: Event): void => {
              void this.setDisplay({ codeFont: (event.target as HTMLInputElement).value });
            }}
          />
        </div>
        <div class="row">
          <label
            for="prose-font"
            title="The font rendered Markdown files are read in: a font-family list, such as Charter, serif. IBM Plex Sans and the system font stay as fallbacks."
          >
            Prose font
          </label>
          <input
            id="prose-font"
            type="text"
            spellcheck="false"
            placeholder="IBM Plex Sans"
            .value=${display.proseFont ?? ''}
            @change=${(event: Event): void => {
              void this.setDisplay({ proseFont: (event.target as HTMLInputElement).value });
            }}
          />
        </div>
      </div>`;
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

  /**
   * Language servers beyond beuve's own, and changes to them, are configured in a JSON file the
   * reviewer edits (ADR 0111): the button opens it, and Review › Restart Language Servers reads it
   * again.
   */
  private renderLanguageServers(): TemplateResult {
    return html`<h2>Language servers</h2>
      <div class="group">
        <div class="row" data-setting="language-servers">
          <span>Configuration</span>
          <span>
            <button
              class="button"
              type="button"
              @click=${(): void => {
                void this.openLanguageServers();
              }}
            >
              Open language-servers.json
            </button>
            <div class="detail">
              ${this.languageServersNote === '' ? defaultLanguageServersNote : this.languageServersNote}
            </div>
          </span>
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
      ${display === undefined ? nothing : html`${this.renderBranches(display)} ${this.renderFonts(display)}`}
      ${this.renderAccounts()} ${this.renderLanguageServers()}
      <beuve-model-settings .api=${this.api}></beuve-model-settings>
      ${this.error === '' ? nothing : html`<p class="error" role="alert">${this.error}</p>`}
    `;
  }
}

const githubPrefix = /^GitHub: /u;

const defaultLanguageServersNote =
  'Read from ~/.config/beuve and from beuve’s own settings folder, the second winning. Restart Language Servers (Review menu) reads it again.';

/** `claude/, codex/` as a list of prefixes; main drops what is not a safe ref prefix. */
function prefixesFrom(text: string): string[] {
  return text
    .split(',')
    .map((prefix) => prefix.trim())
    .filter((prefix) => prefix !== '');
}

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
