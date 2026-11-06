import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { PullRequestSessionView, PullRequestStackEntryView } from '#contract/ipc-contract.ts';

import { ActionDelegation } from './action-delegation.ts';
import { describePullRequestState } from './describe-pull-request-state.ts';
import { createMarkdownNodes } from './create-markdown-nodes.ts';
import { createPlainMarkdownRenderers } from './create-plain-markdown-renderers.ts';
import { markdownBodyStyles } from './markdown-body-styles.ts';
import { parseMarkdown } from './parse-markdown.ts';

/**
 * The intent of a pull request session (spec Zone 1, top): its title, state, author and branches,
 * the body rendered as Markdown (ADR 0073) in text nodes, and the stack neighbours as chips.
 * Links never navigate: they emit `beuve-open-link` with `{ url }`, and main opens GitHub links in
 * the browser (ADR 0040), and only `http(s)` links are links. A chip emits `beuve-open-stack` with `{ ref }`.
 */
@customElement('beuve-pull-request-intent')
export class BeuvePullRequestIntent extends LitElement {
  static override styles = [
    markdownBodyStyles,
    css`
      :host {
        display: grid;
        gap: var(--beuve-space-2);
      }

      h3 {
        margin: 0;
        font: var(--beuve-font-body);
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
        font: var(--beuve-font-mono);
        font-size: var(--beuve-font-size-caption);
        overflow-wrap: anywhere;
      }

      .badge {
        padding: 0 6px;
        border: 1px solid currentColor;
        border-radius: var(--beuve-radius-full);
        font-weight: var(--beuve-font-weight-semibold);
      }

      .badge.ok {
        color: var(--beuve-ok);
      }

      .badge.merged {
        color: var(--beuve-violet);
      }

      .badge.danger {
        color: var(--beuve-danger);
      }

      .body {
        max-block-size: 240px;
        overflow: auto;
        font: var(--beuve-font-small);
        color: var(--beuve-text);
        overflow-wrap: anywhere;
      }

      .empty {
        margin: 0;
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      a {
        color: var(--beuve-accent);
        overflow-wrap: anywhere;
      }

      button.link {
        padding: 0;
        border: 0;
        background: none;
        color: var(--beuve-accent);
        font: inherit;
        text-align: start;
        text-decoration: underline;
        cursor: pointer;
        overflow-wrap: anywhere;
      }

      .stack {
        display: flex;
        flex-wrap: wrap;
        gap: var(--beuve-space-1);
      }

      .chip {
        max-inline-size: 100%;
        overflow: hidden;
        padding: 1px var(--beuve-space-2);
        border: 1px solid var(--beuve-border);
        border-radius: var(--beuve-radius-full);
        background: var(--beuve-surface-sunken);
        color: var(--beuve-text);
        font: var(--beuve-font-small);
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: pointer;
      }

      .chip:hover {
        border-color: var(--beuve-accent);
      }
    `,
  ];

  private shownBody: { readonly body: string; readonly nodes: Element[] } | undefined;

  @property({ attribute: false }) accessor view: PullRequestSessionView | undefined;

  constructor() {
    super();
    // ADR 0074: the description's links and the stack's chips, through one listener.
    this.addController(
      new ActionDelegation(this, {
        click: {
          link: ({ url = '' }, event): void => {
            event.preventDefault();
            this.emit('beuve-open-link', { url });
          },
          stack: ({ ref = '' }): void => {
            this.emit('beuve-open-stack', { ref });
          },
        },
      }),
    );
  }

  private emit(name: string, detail: object): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  /** The body's nodes, built once per body text so a re-render keeps them (and a selection). */
  private bodyNodes(body: string): Element[] {
    if (this.shownBody?.body !== body) {
      const nodes = createMarkdownNodes(parseMarkdown(body), createPlainMarkdownRenderers());
      this.shownBody = { body, nodes };
    }
    return this.shownBody.nodes;
  }

  private renderChip(entry: PullRequestStackEntryView, direction: '↑' | '↓'): TemplateResult {
    const label = `${direction} #${String(entry.number)} ${entry.title}`;
    return html`<button
      type="button"
      class="chip"
      title="${direction === '↑' ? 'Base' : 'Stacked on this'}: ${entry.title}${
        entry.isDraft ? ' (draft)' : ''
      }"
      data-action="stack"
      data-ref=${entry.ref}
    >
      ${label}
    </button>`;
  }

  override render(): TemplateResult | typeof nothing {
    const { view } = this;
    if (view === undefined) {
      return nothing;
    }
    const { pullRequest, stack } = view;
    const badge = describePullRequestState(pullRequest);
    const bodyNodes = this.bodyNodes(pullRequest.body);
    const chips = [
      ...stack.parents.map((entry) => this.renderChip(entry, '↑')),
      ...stack.children.map((entry) => this.renderChip(entry, '↓')),
    ];
    return html`
      <h3>${pullRequest.title}</h3>
      <div class="meta">
        <span class="badge ${badge.tone}">${badge.label}</span>
        <button
          type="button"
          class="link"
          title=${pullRequest.htmlUrl}
          data-action="link"
          data-url=${pullRequest.htmlUrl}
        >
          ${pullRequest.owner}/${pullRequest.repo}#${pullRequest.number}
        </button>
        <span>@${pullRequest.author}</span>
      </div>
      <div class="branches" title="base ← head">
        ${pullRequest.baseBranch} ← ${pullRequest.headBranch}
      </div>
      ${
        bodyNodes.length === 0
          ? html`<p class="empty">No description.</p>`
          : html`<div class="body">${bodyNodes}</div>`
      }
      ${chips.length === 0 ? nothing : html`<div class="stack" aria-label="Stack">${chips}</div>`}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-pull-request-intent': BeuvePullRequestIntent;
  }
}
