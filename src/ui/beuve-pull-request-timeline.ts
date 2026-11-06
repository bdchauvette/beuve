import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { TimelineEventView } from '#contract/ipc-contract.ts';

import { ActionDelegation } from './action-delegation.ts';
import { createMarkdownNodes } from './create-markdown-nodes.ts';
import { createPlainMarkdownRenderers } from './create-plain-markdown-renderers.ts';
import { describeTimelineEvent } from './describe-timeline-event.ts';
import { formatRelativeTime } from './format-relative-time.ts';
import { markdownBodyStyles } from './markdown-body-styles.ts';
import { parseMarkdown } from './parse-markdown.ts';
import type { TimelineState } from './timeline-state.ts';

/** Only the latest events are drawn, so a very long history stays quick. */
const maxShown = 100;

/**
 * A pull request's activity (ADR 0110): its commits, reviews and conversation comments, oldest
 * first, each with who did it, when, and the words they wrote. Bodies are untrusted Markdown,
 * rendered through text nodes only (ADR 0073). Links never navigate: they, the commits and the
 * times emit `beuve-open-link { url }`, and main opens GitHub's own links in the browser.
 */
@customElement('beuve-pull-request-timeline')
export class BeuvePullRequestTimeline extends LitElement {
  static override styles = [
    markdownBodyStyles,
    css`
      :host {
        display: grid;
        gap: var(--beuve-space-2);
        font: var(--beuve-font-small);
      }

      h2 {
        margin: 0;
        font: var(--beuve-font-small);
        font-weight: var(--beuve-font-weight-semibold);
        color: var(--beuve-text-muted);
      }

      .note {
        margin: 0;
        color: var(--beuve-text-muted);
      }

      .events {
        display: grid;
        gap: var(--beuve-space-3);
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .events > li {
        display: grid;
        grid-template-columns: 7px 1fr;
        column-gap: var(--beuve-space-2);
        min-inline-size: 0;
      }

      .dot {
        align-self: start;
        inline-size: 7px;
        block-size: 7px;
        margin-block-start: 5px;
        border-radius: 50%;
        background: var(--beuve-text-muted);
      }

      .dot.ok {
        background: var(--beuve-ok-solid);
      }

      .dot.warn {
        background: var(--beuve-warn-solid);
      }

      .dot.danger {
        background: var(--beuve-danger-solid);
      }

      .what {
        display: grid;
        gap: 2px;
        min-inline-size: 0;
      }

      .who {
        overflow-wrap: anywhere;
      }

      .who strong {
        font-weight: var(--beuve-font-weight-semibold);
      }

      .when,
      .sha {
        color: var(--beuve-text-muted);
      }

      button.link {
        padding: 0;
        border: 0;
        background: none;
        color: var(--beuve-accent);
        font: inherit;
        text-align: start;
        cursor: pointer;
      }

      button.link:hover {
        text-decoration: underline;
      }

      button.when {
        color: var(--beuve-text-muted);
      }

      .headline {
        overflow-wrap: anywhere;
      }

      .sha {
        font: var(--beuve-font-mono);
        font-size: var(--beuve-font-size-caption);
      }

      .body {
        max-block-size: 160px;
        overflow: auto;
        color: var(--beuve-text);
        overflow-wrap: anywhere;
      }

      a {
        color: var(--beuve-accent);
      }
    `,
  ];

  /** Built bodies by event URL and text, so a re-render keeps the nodes (and a selection). */
  private bodies = new Map<string, Element[]>();

  /** The activity, or `undefined` before it was asked for. */
  @property({ attribute: false }) accessor timeline: TimelineState | undefined;

  constructor() {
    super();
    this.addController(
      new ActionDelegation(this, {
        click: {
          link: ({ url = '' }, event): void => {
            event.preventDefault();
            this.dispatchEvent(
              new CustomEvent('beuve-open-link', {
                detail: { url },
                bubbles: true,
                composed: true,
              }),
            );
          },
        },
      }),
    );
  }

  private bodyNodes(event: TimelineEventView): Element[] {
    const key = bodyKey(event);
    let nodes = this.bodies.get(key);
    if (nodes === undefined) {
      let body = '';
      if (event.kind !== 'commit') {
        ({ body } = event);
      }
      nodes = createMarkdownNodes(parseMarkdown(body), createPlainMarkdownRenderers());
      this.bodies.set(key, nodes);
    }
    return nodes;
  }

  private renderEvent(event: TimelineEventView, now: Temporal.Instant): TemplateResult {
    const { verb, tone } = describeTimelineEvent(event);
    const hasBody = event.kind !== 'commit' && event.body.trim() !== '';
    return html`<li>
      <span class="dot ${tone}"></span>
      <div class="what">
        <div class="who">
          <strong>${event.author}</strong> ${verb}
          <button
            type="button"
            class="link when"
            title=${`${event.at}: open on GitHub`}
            data-action="link"
            data-url=${event.url}
          >
            ${formatRelativeTime(event.at, now)}
          </button>
        </div>
        ${
          event.kind === 'commit'
            ? html`<div class="headline">
                ${event.headline}
                <button
                  type="button"
                  class="link sha"
                  title=${`Open ${event.sha} on GitHub`}
                  data-action="link"
                  data-url=${event.url}
                >
                  ${event.sha.slice(0, 7)}
                </button>
              </div>`
            : nothing
        }
        ${hasBody ? html`<div class="body">${this.bodyNodes(event)}</div>` : nothing}
      </div>
    </li>`;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has('timeline')) {
      return;
    }
    const kept = new Map<string, Element[]>();
    if (this.timeline?.kind === 'ready') {
      for (const event of this.timeline.events) {
        const key = bodyKey(event);
        const existing = this.bodies.get(key);
        if (existing !== undefined) {
          kept.set(key, existing);
        }
      }
    }
    this.bodies = kept;
  }

  protected override render(): TemplateResult | typeof nothing {
    const { timeline } = this;
    if (timeline === undefined) {
      return nothing;
    }
    if (timeline.kind === 'loading') {
      return html`<h2>Activity</h2>
        <p class="note">Loading…</p>`;
    }
    if (timeline.kind === 'failed') {
      return html`<h2>Activity</h2>
        <p class="note">${timeline.message}</p>`;
    }
    if (timeline.events.length === 0) {
      return html`<h2>Activity</h2>
        <p class="note">Nothing has happened on this pull request yet.</p>`;
    }
    const shown = timeline.events.slice(-maxShown);
    const now = Temporal.Now.instant();
    return html`<h2>Activity</h2>
      ${
        shown.length < timeline.events.length
          ? html`<p class="note">
              Showing the latest ${shown.length} of ${timeline.events.length}.
            </p>`
          : nothing
      }
      <ol class="events">
        ${shown.map((event) => this.renderEvent(event, now))}
      </ol>
      ${timeline.isTruncated ? html`<p class="note">GitHub has more history than was read.</p>` : nothing}`;
  }
}

function bodyKey(event: TimelineEventView): string {
  if (event.kind === 'commit') {
    return event.url;
  }
  return `${event.url}\0${event.body}`;
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-pull-request-timeline': BeuvePullRequestTimeline;
  }
}
