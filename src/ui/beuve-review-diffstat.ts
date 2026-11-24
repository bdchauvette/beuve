import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { ReviewView } from '#contract/ipc-contract.ts';

import { ActionDelegation } from './action-delegation.ts';
import { countNoun } from './count-noun.ts';
import './primitives/beuve-commit.ts';

/** `beuve-open-commit`: a commit hash of the title band, to open on the remote (ADR 0108). */
export interface OpenCommitDetail {
  readonly sha: string;
}

/**
 * What the open review's diff spans, at the end of the title band (ADR 0157): its commits
 * (`abc1234..def5678`), how many files and its line counts, parted by middle dots. The commits
 * give way first when the band is narrow; what the diff shows (the range menu) is in the status
 * bar. Emits `beuve-open-commit { sha }` for a commit.
 */
@customElement('beuve-review-diffstat')
export class BeuveReviewDiffstat extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      align-items: center;
      gap: var(--beuve-space-2);
      min-inline-size: 0;
      font: var(--beuve-font-code);
      color: var(--beuve-text-muted);
      white-space: nowrap;
    }

    .range {
      min-inline-size: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .separator,
    .files,
    .lines {
      flex: none;
    }

    .separator {
      color: var(--beuve-text-faint);
    }

    .added {
      color: var(--beuve-diff-added-text);
    }

    .deleted {
      color: var(--beuve-diff-removed-text);
    }
  `;

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
            const detail: OpenCommitDetail = { sha };
            this.dispatchEvent(
              new CustomEvent('beuve-open-commit', { detail, bubbles: true, composed: true }),
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
    let additions = 0;
    let deletions = 0;
    for (const file of review.files) {
      additions += file.additions;
      deletions += file.deletions;
    }
    const range = html`<span class="range" title=${rangeTitle(review)}
      >${this.renderCommit(rangeStartOf(review))}..${this.renderCommit(review.headSha)}</span
    >`;
    if (review.files.length === 0) {
      return range;
    }
    return html`${range}<span class="separator" aria-hidden="true">·</span
      ><span class="files">${countNoun(review.files.length, 'file')}</span
      ><span class="separator" aria-hidden="true">·</span
      ><span class="lines" title="Lines added and deleted"
        ><span class="added">+${additions}</span> <span class="deleted">−${deletions}</span></span
      >`;
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
    'beuve-review-diffstat': BeuveReviewDiffstat;
  }
}
