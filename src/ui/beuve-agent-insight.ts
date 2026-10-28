import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { AgentInsightView, InsightStatusView } from '#contract/ipc-contract.ts';

import { parseInsightMarkdown } from './parse-insight-markdown.ts';
import type { InlineSpan, MarkdownBlock } from './parse-insight-markdown.ts';

const promoteTitle =
  'Promote (y): mark this insight as worth raising. Staging it into the review dock (URA) arrives with the dock; for now it is only marked promoted.';

/**
 * One agent insight (spec 5B) as a subtle purple annotation under the diff line it refers to:
 * severity, category, lines, confidence, title and a safe Markdown subset of its body. Dismissed
 * insights collapse to a one-line stub. Asks for status changes with `beuve-insight-status`
 * (`y`/`d` do the same from the diff stream) and reports clicks with `beuve-insight-focus`.
 * Light enough to render inside a `@pierre/diffs` annotation slot later (ADR 0018).
 */
@customElement('beuve-agent-insight')
export class BeuveAgentInsight extends LitElement {
  static override styles = css`
    :host {
      display: block;
      margin: var(--beuve-space-1) var(--beuve-space-3);
      white-space: normal;
      font: var(--beuve-font-body);
      color: var(--beuve-text);
    }

    .box {
      padding: var(--beuve-space-2) var(--beuve-space-3);
      border: 1px solid color-mix(in srgb, var(--beuve-insight) 30%, transparent);
      border-left: 3px solid var(--beuve-insight);
      border-radius: var(--beuve-radius);
      background: color-mix(in srgb, var(--beuve-insight) 6%, var(--beuve-surface));
    }

    :host([focused]) .box,
    :host([focused]) .stub {
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--beuve-insight) 55%, transparent);
    }

    .head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--beuve-space-2);
      font: var(--beuve-font-small);
      color: var(--beuve-text-muted);
    }

    .label {
      font-weight: 600;
      color: var(--beuve-insight);
    }

    .chip {
      padding: 0 var(--beuve-space-1);
      border: 1px solid currentcolor;
      border-radius: 4px;
    }

    .risk {
      color: var(--beuve-danger);
    }

    .warning {
      color: var(--beuve-warn);
    }

    .info {
      color: var(--beuve-text-muted);
    }

    .promoted {
      color: var(--beuve-insight);
      font-weight: 600;
    }

    .spacer {
      flex: 1;
    }

    button {
      padding: 0 var(--beuve-space-2);
      border: 1px solid var(--beuve-border);
      border-radius: 4px;
      background: var(--beuve-surface);
      color: var(--beuve-text);
      font: var(--beuve-font-small);
      cursor: pointer;
    }

    button:hover {
      border-color: var(--beuve-insight);
    }

    .title {
      margin-top: var(--beuve-space-1);
      font-weight: 600;
    }

    .body p,
    .body ul {
      margin: var(--beuve-space-1) 0 0;
    }

    .body ul {
      padding-left: var(--beuve-space-4);
    }

    code,
    pre {
      font: var(--beuve-font-mono);
    }

    code {
      padding: 0 2px;
      border-radius: 3px;
      background: var(--beuve-surface-sunken);
    }

    pre {
      margin: var(--beuve-space-1) 0 0;
      padding: var(--beuve-space-1) var(--beuve-space-2);
      overflow-x: auto;
      border-radius: 4px;
      background: var(--beuve-surface-sunken);
    }

    .stub {
      display: flex;
      align-items: center;
      gap: var(--beuve-space-2);
      padding: 2px var(--beuve-space-3);
      border-left: 3px solid color-mix(in srgb, var(--beuve-insight) 40%, transparent);
      border-radius: var(--beuve-radius);
      font: var(--beuve-font-small);
      color: var(--beuve-text-muted);
    }

    .stub .text {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `;

  private readonly onClick = (): void => {
    if (this.insight !== undefined) {
      this.dispatchEvent(
        new CustomEvent('beuve-insight-focus', {
          detail: { insightId: this.insight.id },
          bubbles: true,
          composed: true,
        }),
      );
    }
  };

  @property({ attribute: false }) accessor insight: AgentInsightView | undefined;
  @property({ type: Boolean, reflect: true }) accessor focused = false;

  constructor() {
    super();
    this.addEventListener('click', this.onClick);
  }

  private request(status: InsightStatusView): (event: Event) => void {
    return (event: Event): void => {
      event.stopPropagation();
      if (this.insight === undefined) {
        return;
      }
      this.dispatchEvent(
        new CustomEvent('beuve-insight-status', {
          detail: { insightId: this.insight.id, status },
          bubbles: true,
          composed: true,
        }),
      );
    };
  }

  override render(): TemplateResult | typeof nothing {
    const { insight } = this;
    if (insight === undefined) {
      return nothing;
    }
    if (insight.status === 'dismissed') {
      return html`<div class="stub" role="note">
        <span class="label">Agent insight</span>
        <span class="text">dismissed · ${insight.title}</span>
        <button type="button" title="Restore (d)" @click=${this.request('pending')}>Restore</button>
      </div>`;
    }
    const isPromoted = insight.status === 'promoted';
    return html`<div class="box" role="note" aria-label="Agent insight: ${insight.title}">
      <div class="head">
        <span class="label">Agent insight</span>
        <span class="chip ${insight.severity}">${insight.severity}</span>
        <span>${insight.category.replaceAll('-', ' ')}</span>
        <span>${lineLabel(insight)}</span>
        <span title="The model's confidence that a careful reviewer would agree"
          >${Math.round(insight.confidence * 100)}% confident</span
        >
        <span class="spacer"></span>
        ${isPromoted ? html`<span class="promoted" title=${promoteTitle}>Promoted</span>` : nothing}
        <button
          type="button"
          title=${isPromoted ? 'Undo the promotion (y)' : promoteTitle}
          @click=${this.request(isPromoted ? 'pending' : 'promoted')}
        >
          ${isPromoted ? 'Unpromote' : 'Promote'}
        </button>
        <button type="button" title="Dismiss (d)" @click=${this.request('dismissed')}>
          Dismiss
        </button>
      </div>
      <div class="title">${insight.title}</div>
      <div class="body">
        ${parseInsightMarkdown(insight.body).map((block) => renderBlock(block))}
      </div>
    </div>`;
  }
}

function lineLabel(insight: AgentInsightView): string {
  return insight.lineStart === insight.lineEnd
    ? `line ${String(insight.lineStart)}`
    : `lines ${String(insight.lineStart)}–${String(insight.lineEnd)}`;
}

function renderBlock(block: MarkdownBlock): TemplateResult {
  switch (block.kind) {
    case 'paragraph': {
      return html`<p>${block.spans.map((span) => renderSpan(span))}</p>`;
    }
    case 'list': {
      return html`<ul>
        ${block.items.map((item) => html`<li>${item.map((span) => renderSpan(span))}</li>`)}
      </ul>`;
    }
    case 'code': {
      return html`<pre>${block.text}</pre>`;
    }
  }
}

function renderSpan(span: InlineSpan): TemplateResult | string {
  switch (span.kind) {
    case 'text': {
      return span.text;
    }
    case 'code': {
      return html`<code>${span.text}</code>`;
    }
    case 'strong': {
      return html`<strong>${span.text}</strong>`;
    }
    case 'emphasis': {
      return html`<em>${span.text}</em>`;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-agent-insight': BeuveAgentInsight;
  }
}
