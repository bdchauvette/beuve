import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { descriptionSheetTitleFrom } from '#contract/description-sheet-title-from.ts';
import type {
  DescriptionSheetView,
  IpcResult,
  PullRequestView,
  SheetApi,
} from '#contract/ipc-contract.ts';

import { ActionDelegation } from './action-delegation.ts';
import { applyFonts } from './apply-fonts.ts';
import { createMarkdownNodes } from './create-markdown-nodes.ts';
import { createPlainMarkdownRenderers } from './create-plain-markdown-renderers.ts';
import { describePullRequestState } from './describe-pull-request-state.ts';
import { markdownBodyStyles } from './markdown-body-styles.ts';
import { parseMarkdown } from './parse-markdown.ts';
import { badgeStyles } from './primitives/badge-styles.ts';
import { buttonStyles } from './primitives/button-styles.ts';
import './primitives/beuve-time.ts';

type Loaded =
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready';
      readonly pullRequest: PullRequestView;
      readonly nodes: readonly Element[];
    }
  | { readonly status: 'error'; readonly message: string };

/**
 * A description sheet (ADR 0135): a pull request's title, state, branches and Markdown body as
 * they were when the sheet opened, like a printout beside the review. Read-only and never
 * refreshed: when the window gains focus and GitHub's title or body differs, a quiet note says so.
 * Links are copied, since a sheet opens nothing (ADR 0067). Esc or Close Window closes it.
 */
@customElement('beuve-description-sheet')
export class BeuveDescriptionSheet extends LitElement {
  static override styles = [
    badgeStyles,
    buttonStyles,
    markdownBodyStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        block-size: 100%;
        min-block-size: 0;
        background: var(--beuve-surface);
        color: var(--beuve-text);
        outline: none;
      }

      header {
        display: flex;
        align-items: center;
        gap: var(--beuve-space-2);
        padding: var(--beuve-space-2) var(--beuve-space-3);
        border-block-end: var(--beuve-border-width) solid var(--beuve-border);
        font: var(--beuve-font-small);
        -webkit-app-region: drag;
      }

      header > * {
        -webkit-app-region: no-drag;
      }

      .reference {
        flex: 1;
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--beuve-text-muted);
        -webkit-app-region: drag;
      }

      .stamp {
        color: var(--beuve-text-muted);
        white-space: nowrap;
      }

      .page {
        flex: 1;
        min-block-size: 0;
        overflow: auto;
        padding: var(--beuve-space-4);
      }

      .sheet {
        display: grid;
        gap: var(--beuve-space-2);
        max-inline-size: var(--beuve-size-note-measure);
      }

      h1 {
        margin: 0;
        font: var(--beuve-font-body);
        font-size: var(--beuve-font-size-large);
        font-weight: var(--beuve-font-weight-semibold);
        overflow-wrap: anywhere;
      }

      .meta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--beuve-space-1) var(--beuve-space-2);
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      .branches {
        font: var(--beuve-font-code);
        font-size: var(--beuve-font-size-caption);
        overflow-wrap: anywhere;
      }

      .body {
        padding-block-start: var(--beuve-space-2);
        border-block-start: var(--beuve-border-width) solid var(--beuve-border);
        font: var(--beuve-font-body);
        font-family: var(--beuve-font-family-prose);
        overflow-wrap: anywhere;
      }

      .body a {
        color: var(--beuve-accent);
      }

      .note {
        margin: 0;
        color: var(--beuve-text-muted);
        font: var(--beuve-font-body);
      }

      footer {
        display: flex;
        padding: var(--beuve-space-1) var(--beuve-space-3);
        border-block-start: var(--beuve-border-width) solid var(--beuve-border);
        color: var(--beuve-text-muted);
        font: var(--beuve-font-small);
      }

      footer .notice {
        flex: 1;
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      footer .notice.error {
        color: var(--beuve-danger);
      }
    `,
  ];

  private readonly printedAt = Temporal.Now.instant().toString();

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  private readonly onFocus = (): void => {
    void this.checkChanged();
  };

  @property({ attribute: false }) accessor api: SheetApi | undefined;
  @property() accessor sessionId = '';

  @state() accessor loaded: Loaded = { status: 'loading' };
  @state() accessor notice: { readonly text: string; readonly isError: boolean } | undefined;
  /** Whether GitHub's title or body differs from the printed one, as of the last focus. */
  @state() accessor hasChanged = false;

  constructor() {
    super();
    // ADR 0074: the body's links, through one listener.
    this.addController(
      new ActionDelegation(this, {
        click: {
          link: ({ url = '' }, event): void => {
            event.preventDefault();
            void this.copy(url);
          },
        },
      }),
    );
  }

  private async load(): Promise<void> {
    const bridge = this.api;
    if (bridge === undefined) {
      this.loaded = { status: 'error', message: 'This sheet has no connection to beuve.' };
      return;
    }
    void readDisplay(bridge);
    // Nothing in the menus acts on a description: no file, no lines, no history (ADR 0068).
    void bridge.invoke('menu:set-state', { conditions: [], checked: [] });
    const description = await this.read(bridge);
    if (!description.ok) {
      this.loaded = { status: 'error', message: description.error.message };
      return;
    }
    const { pullRequest } = description.value;
    const nodes = createMarkdownNodes(
      parseMarkdown(pullRequest.body),
      createPlainMarkdownRenderers(),
    );
    this.loaded = { status: 'ready', pullRequest, nodes };
  }

  private async read(bridge: SheetApi): Promise<IpcResult<DescriptionSheetView>> {
    return bridge.invoke('sheet:get-description', { sessionId: this.sessionId });
  }

  private async checkChanged(): Promise<void> {
    const { api, loaded } = this;
    if (api === undefined || loaded.status !== 'ready') {
      return;
    }
    const now = await this.read(api);
    if (!now.ok) {
      return;
    }
    const { title, body } = now.value.pullRequest;
    this.hasChanged = title !== loaded.pullRequest.title || body !== loaded.pullRequest.body;
  }

  private async copy(text: string): Promise<void> {
    const copied = await this.api?.invoke('clipboard:write-text', { text });
    if (copied?.ok === true) {
      this.notice = { text: `Copied ${text}`, isError: false };
      return;
    }
    this.notice = { text: 'The link could not be copied.', isError: true };
  }

  private footerText(): string {
    if (this.notice !== undefined) {
      return this.notice.text;
    }
    if (this.hasChanged) {
      return 'The description has changed on GitHub since this was printed.';
    }
    return 'read-only';
  }

  private renderPage(): TemplateResult {
    const { loaded } = this;
    switch (loaded.status) {
      case 'loading': {
        return html`<p class="note">Reading the description…</p>`;
      }
      case 'error': {
        return html`<p class="note">${loaded.message}</p>`;
      }
      case 'ready': {
        return this.renderSheet(loaded.pullRequest, loaded.nodes);
      }
    }
  }

  private renderSheet(pullRequest: PullRequestView, nodes: readonly Element[]): TemplateResult {
    const badge = describePullRequestState(pullRequest);
    return html`<article class="sheet">
      <h1>${pullRequest.title}</h1>
      <div class="meta">
        <span class="badge" data-tone=${badge.tone}>${badge.label}</span>
        <span>@${pullRequest.author}</span>
        <span class="branches" title="base ← head"
          >${pullRequest.baseBranch} ← ${pullRequest.headBranch}</span
        >
      </div>
      ${
        nodes.length === 0
          ? html`<p class="note">No description.</p>`
          : html`<div class="body">${nodes}</div>`
      }
    </article>`;
  }

  private renderReference(): TemplateResult {
    const { loaded } = this;
    if (loaded.status !== 'ready') {
      return html`<span class="reference"></span>`;
    }
    const { owner, repo, number, htmlUrl } = loaded.pullRequest;
    return html`<span class="reference" title=${htmlUrl}
      >${owner}/${repo}#${String(number)} · description</span
    >`;
  }

  private renderCopyLink(): TemplateResult | typeof nothing {
    const { loaded } = this;
    if (loaded.status !== 'ready') {
      return nothing;
    }
    const { htmlUrl } = loaded.pullRequest;
    return html`<button
      class="button"
      type="button"
      title="Copy a link to the pull request"
      @click=${(): void => {
        void this.copy(htmlUrl);
      }}
    >
      Copy link
    </button>`;
  }

  override connectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.connectedCallback();
    this.tabIndex = 0;
    this.addEventListener('keydown', this.onKeyDown);
    addEventListener('focus', this.onFocus);
    void this.load();
  }

  override disconnectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.disconnectedCallback();
    this.removeEventListener('keydown', this.onKeyDown);
    removeEventListener('focus', this.onFocus);
  }

  protected override updated(): void {
    if (this.loaded.status === 'ready') {
      document.title = descriptionSheetTitleFrom(this.loaded.pullRequest);
    }
  }

  override render(): TemplateResult {
    return html`
      <header>
        ${this.renderReference()}
        <span class="stamp"
          >printed <beuve-time datetime=${this.printedAt} time-style="short"></beuve-time
        ></span>
        ${this.renderCopyLink()}
      </header>
      <div class="page">${this.renderPage()}</div>
      <footer>
        <span class="notice ${this.notice?.isError === true ? 'error' : ''}"
          >${this.footerText()}</span
        >
      </footer>
    `;
  }
}

async function readDisplay(bridge: SheetApi): Promise<void> {
  const display = await bridge.invoke('display:get');
  if (display.ok) {
    applyFonts(display.value);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-description-sheet': BeuveDescriptionSheet;
  }
}
