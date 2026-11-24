import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { ReviewView } from '#contract/ipc-contract.ts';

import { countNoun } from './count-noun.ts';

/**
 * How big the open review's diff is, at the end of the title band (ADR 0157): how many files and
 * its line counts, parted by a middle dot. The commits it spans and what it shows (the range
 * menu) are in the status bar.
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
    if (review.files.length === 0) {
      return nothing;
    }
    return html`<span class="files">${countNoun(review.files.length, 'file')}</span
      ><span class="separator" aria-hidden="true">·</span
      ><span class="lines" title="Lines added and deleted"
        ><span class="added">+${additions}</span> <span class="deleted">−${deletions}</span></span
      >`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-review-diffstat': BeuveReviewDiffstat;
  }
}
