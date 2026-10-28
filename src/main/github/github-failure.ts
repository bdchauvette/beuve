import type { GithubFailureKind, GithubFailureView } from '#contract/ipc-contract.ts';

/** A {@link GithubFailureView}, the expected-failure answer of every GitHub channel. */
export function githubFailure(
  failure: GithubFailureKind,
  message: string,
  remedy?: string,
): GithubFailureView {
  return { kind: 'failed', failure, message, ...(remedy !== undefined && { remedy }) };
}
