import { describeReviewPreview } from './describe-review-preview.ts';
import type { GithubPreviewState } from './github-post-state.ts';

/**
 * What the line beside the dock's Post button says will be posted (ADR 0039 amendment
 * 2026-11-18): the preview's counts, verdict and head, the last ones while a fresh preview is
 * compiled, or why there is none. Pure.
 */
export function describePostPreview(state: GithubPreviewState): string {
  switch (state.kind) {
    case 'ready': {
      return describeReviewPreview(state.preview);
    }
    case 'loading': {
      if (state.last === undefined) {
        return 'Compiling the review…';
      }
      return describeReviewPreview(state.last);
    }
    case 'failed': {
      return `Couldn't compile the review: ${state.text}`;
    }
    case 'none': {
      return 'Not compiled yet.';
    }
  }
}
