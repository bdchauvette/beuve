import type { GithubReviewPreviewView } from '#contract/ipc-contract.ts';

/** Options of {@link createGithubPreview}. */
export interface GithubPreviewOptions {
  readonly sessionId: string;
  readonly headSha: string;
}

/** A preview of an approving review with one inline comment. */
export function createGithubPreview(options: GithubPreviewOptions): GithubReviewPreviewView {
  return {
    ...options,
    verdict: 'approve',
    summary: 'Looks good.',
    inlineCount: 1,
    bodyCount: 0,
    alreadyPostedCount: 0,
  };
}
