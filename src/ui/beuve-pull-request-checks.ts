import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { CiBucketView, CiCheckView, CiStatusView } from '#contract/ipc-contract.ts';

import { ActionDelegation } from './action-delegation.ts';
import { describeCiStatus } from './describe-ci-status.ts';
import { buttonStyles } from './primitives/button-styles.ts';

/** Worst first, so a failing check is at the top of the list. */
const bucketRank: Readonly<Record<CiBucketView, number>> = {
  failure: 0,
  pending: 1,
  success: 2,
  neutral: 3,
};

const bucketTone: Readonly<Record<CiBucketView, string>> = {
  failure: 'danger',
  pending: 'warn',
  success: 'ok',
  neutral: '',
};

/**
 * A pull request's CI for the head: the rollup line and every check, worst first, as in the status
 * bar's popover. A check with a link emits `beuve-open-url { url }` (main opens it in the browser).
 */
@customElement('beuve-pull-request-checks')
export class BeuvePullRequestChecks extends LitElement {
  static override styles = [
    buttonStyles,
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

      p {
        margin: 0;
        color: var(--beuve-text-muted);
      }

      ul {
        display: grid;
        gap: 2px;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      li {
        display: flex;
        align-items: center;
        gap: var(--beuve-space-2);
        min-inline-size: 0;
      }

      .dot {
        flex: none;
        inline-size: 7px;
        block-size: 7px;
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

      .name {
        flex: 1;
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .state {
        color: var(--beuve-text-muted);
      }
    `,
  ];

  /** The head's CI; absent until it is fetched. */
  @property({ attribute: false }) accessor ci: CiStatusView | undefined;

  constructor() {
    super();
    this.addController(
      new ActionDelegation(this, {
        click: {
          'open-url': ({ url }): void => {
            if (url !== undefined) {
              this.dispatchEvent(
                new CustomEvent('beuve-open-url', {
                  detail: { url },
                  bubbles: true,
                  composed: true,
                }),
              );
            }
          },
        },
      }),
    );
  }

  private renderCheck(check: CiCheckView): TemplateResult {
    return html`<li>
      <span class="dot ${bucketTone[check.bucket]}"></span>
      ${
        check.url === undefined
          ? html`<span class="name" title=${check.name}>${check.name}</span>`
          : html`<button
              type="button"
              class="button link name"
              title=${`Open ${check.name} on GitHub`}
              data-action="open-url"
              data-url=${check.url}
            >
              ${check.name}
            </button>`
      }
      <span class="state">${check.bucket}</span>
    </li>`;
  }

  protected override render(): TemplateResult | typeof nothing {
    const { ci } = this;
    if (ci === undefined) {
      return nothing;
    }
    const checks = ci.checks.toSorted((a, b) => {
      return bucketRank[a.bucket] - bucketRank[b.bucket];
    });
    let body = html`<p>No checks have reported for this commit.</p>`;
    if (checks.length > 0) {
      body = html`<ul>
        ${checks.map((check) => this.renderCheck(check))}
      </ul>`;
    }
    let summary: string = ci.sha.slice(0, 7);
    if (checks.length > 0) {
      summary = `${describeCiStatus(ci).text} on ${ci.sha.slice(0, 7)}`;
    }
    return html`<h2>Checks</h2>
      <p>${summary}</p>
      ${body} ${ci.isTruncated ? html`<p>More checks exist than were fetched.</p>` : nothing}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-pull-request-checks': BeuvePullRequestChecks;
  }
}
