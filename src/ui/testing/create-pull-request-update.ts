import type { PullRequestUpdatedView } from '#contract/ipc-contract.ts';

/** Options of {@link createPullRequestUpdate}. */
export interface PullRequestUpdateOptions {
  readonly sessionId: string;
  readonly headMoved: boolean;
}

/** A `github:pr-updated` payload; only what the controller reads is real. */
export function createPullRequestUpdate(options: PullRequestUpdateOptions): PullRequestUpdatedView {
  return {
    ...options,
    pullRequest: { number: 7 },
    stack: {},
  } as unknown as PullRequestUpdatedView;
}
