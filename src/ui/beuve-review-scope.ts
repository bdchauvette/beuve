import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { ReviewView } from '#contract/ipc-contract.ts';

import { ActionDelegation } from './action-delegation.ts';
import './beuve-review-range.ts';
import { countNoun } from './count-noun.ts';
import { describeReviewScope } from './describe-review-scope.ts';
import { buttonStyles } from './primitives/button-styles.ts';
import './primitives/beuve-commit.ts';

/** `beuve-open-commit`: a commit hash of the title band, to open on the remote (ADR 0108). */
export interface OpenCommitDetail {
  readonly sha: string;
}

/**
 * What the open review's diff shows, for the title band (ADR 0157): the range menu named by the
 * scope (plain text before the first save), the commits it spans and its line counts. The range
 * gives way first when the band is narrow. Emits `beuve-open-commit { sha }` for a commit, and
 * what `beuve-review-range` emits.
 */
@customElement('beuve-review-scope')
export class BeuveReviewScope extends LitElement {
  static override styles = [
    buttonStyles,
    css`
      :host {
        display: flex;
        align-items: center;
        gap: var(--beuve-space-3);
        min-inline-size: 0;
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
        white-space: nowrap;
      }

      beuve-review-range,
      .scope {
        flex: 0 10 auto;
        min-inline-size: 0;
      }

      .scope {
        overflow: hidden;
        text-overflow: ellipsis;
        color: var(--beuve-text);
        font-weight: var(--beuve-font-weight-semibold);
      }

      .interdiff {
        color: var(--beuve-violet);
      }

      .range {
        flex: 0 1000 auto;
        min-inline-size: 0;
        overflow: hidden;
        font: var(--beuve-font-code);
      }

      .counts {
        flex: none;
        font: var(--beuve-font-code);
      }
    `,
  ];

  /** The open review. */
  @property({ attribute: false }) accessor review: ReviewView | undefined;

  constructor() {
    super();
    this.addController(
      new ActionDelegation(this, {
        click: {
          'open-commit': ({ sha }): void => {
            if (sha === undefined) {
              return;
            }
            this.dispatchEvent(
              new CustomEvent('beuve-open-commit', {
                detail: { sha },
                bubbles: true,
                composed: true,
              }),
            );
          },
        },
      }),
    );
  }

  /** A short sha that opens its commit on the remote (ADR 0108). */
  private renderCommit(sha: string): TemplateResult {
    return html`<beuve-commit
      sha=${sha}
      abbreviation="8"
      hint="Click to open on GitHub"
      data-action="open-commit"
      data-sha=${sha}
    ></beuve-commit>`;
  }

  override render(): TemplateResult | typeof nothing {
    const { review } = this;
    if (review === undefined) {
      return nothing;
    }
    const scopeText = describeReviewScope(review.scope);
    const hasSaves = (review.range?.checkpoints.length ?? 0) > 0;
    let additions = 0;
    let deletions = 0;
    for (const file of review.files) {
      additions += file.additions;
      deletions += file.deletions;
    }
    return html`${
        hasSaves
          ? html`<beuve-review-range
              class=${review.scope.kind}
              .range=${review.range}
              scopeText=${scopeText}
            ></beuve-review-range>`
          : html`<span class="scope ${review.scope.kind}" title=${scopeText}>${scopeText}</span>`
      }
      <span class="range" title=${rangeTitle(review)}
        >${this.renderCommit(rangeStartOf(review))}..${this.renderCommit(review.headSha)}</span
      >
      ${
        review.files.length === 0
          ? nothing
          : html`<span class="counts" title="Files and lines the diff shows"
              >${countNoun(review.files.length, 'file')} +${additions} −${deletions}</span
            >`
      }`;
  }
}

/** The commits the diff spans: fork point to head, or last reviewed head to head. */
function rangeStartOf(review: ReviewView): string {
  if (review.scope.kind === 'interdiff') {
    return review.scope.fromHeadSha;
  }
  return review.baseSha;
}

function rangeTitle(review: ReviewView): string {
  if (review.scope.kind === 'interdiff') {
    return `Changes since reviewed head ${review.scope.fromHeadSha}, now at ${review.headSha} (forked from ${review.baseSha})`;
  }
  return `${review.baseSha}..${review.headSha}`;
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-review-scope': BeuveReviewScope;
  }
}
