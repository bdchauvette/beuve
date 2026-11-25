import type { GithubFetch } from './github-controller.ts';

/** What the window knows about a review on its way. */
export interface ReviewCoverInput {
  /** The GitHub fetch in flight, if any. */
  readonly fetch: GithubFetch | undefined;
  /** Whether a session's review is being read. */
  readonly isLoading: boolean;
  /** Whether a review is shown. */
  readonly hasReview: boolean;
  /** The name of the session being read. */
  readonly loadingLabel: string;
}

/** What the cover over the window shows. */
export interface ReviewCover {
  readonly label: string;
  readonly stage: string;
  /** Whether Cancel stops it: only the fetch can be stopped. */
  readonly cancellable: boolean;
}

/**
 * The cover a review on its way puts over the window (ADR 0146): first the fetch of what the
 * reviewer picked, then the reading of its review, as one cover, so the review being replaced is
 * hidden from the first frame and the window never shows an empty review in between. A fetch
 * from the Open panel (no label) shows its progress there; a reload keeps the review in place.
 */
export function reviewCoverFrom(input: ReviewCoverInput): ReviewCover | undefined {
  const { fetch } = input;
  if (fetch?.kind === 'open' && fetch.label !== '') {
    return { label: fetch.label, stage: fetch.stage, cancellable: true };
  }
  if (input.isLoading && !input.hasReview) {
    return { label: input.loadingLabel, stage: 'Opening review…', cancellable: false };
  }
  return undefined;
}
