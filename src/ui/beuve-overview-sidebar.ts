import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { CiStatusView, PullRequestSessionView } from '#contract/ipc-contract.ts';

import './beuve-pull-request-checks.ts';
import './beuve-pull-request-intent.ts';
import './beuve-pull-request-timeline.ts';
import type { TimelineState } from './timeline-state.ts';
import { zoneStyles } from './zone-styles.ts';

/**
 * The Overview tab of a pull request session (ADR 0109): the pull request's title, state, author,
 * branches, description and stack neighbours, then its CI checks and its activity (ADR 0110). It
 * emits what they emit: `beuve-open-link`, `beuve-open-stack` and `beuve-open-url`.
 */
@customElement('beuve-overview-sidebar')
export class BeuveOverviewSidebar extends LitElement {
  static override styles = [
    zoneStyles,
    css`
      section + section {
        margin-block-start: var(--beuve-space-3);
        padding-block-start: var(--beuve-space-3);
        border-block-start: 1px solid var(--beuve-border);
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) accessor focused = false;
  /** The open pull request session; the tab is not shown without one. */
  @property({ attribute: false }) accessor pullRequest: PullRequestSessionView | undefined;
  /** The head's CI, once fetched. */
  @property({ attribute: false }) accessor ci: CiStatusView | undefined;
  /** The pull request's commits, reviews and comments. */
  @property({ attribute: false }) accessor timeline: TimelineState | undefined;

  override render(): TemplateResult {
    return html`<div class="body">
      ${
        this.pullRequest === undefined
          ? html`<p class="empty">This review is not a pull request.</p>`
          : html`<section>
              <beuve-pull-request-intent .view=${this.pullRequest}></beuve-pull-request-intent>
            </section>`
      }
      ${
        this.ci === undefined
          ? nothing
          : html`<section>
              <beuve-pull-request-checks .ci=${this.ci}></beuve-pull-request-checks>
            </section>`
      }
      ${
        this.timeline === undefined
          ? nothing
          : html`<section>
              <beuve-pull-request-timeline .timeline=${this.timeline}></beuve-pull-request-timeline>
            </section>`
      }
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-overview-sidebar': BeuveOverviewSidebar;
  }
}
