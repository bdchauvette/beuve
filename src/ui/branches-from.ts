import type { PullRequestView, SessionSummary } from '#contract/ipc-contract.ts';

/** The branches a review compares, as the status bar shows them (ADR 0157 amendment). */
export interface ReviewBranches {
  readonly head: string;
  /** Absent while a followed branch's default branch is not known yet. */
  readonly base?: string;
}

/** What {@link branchesFrom} reads. */
export interface BranchFacts {
  readonly session: SessionSummary | undefined;
  /** The open pull request, once loaded; its branches are GitHub's names. */
  readonly pullRequest: PullRequestView | undefined;
}

/**
 * The open review's head and base branches: a local session's refs (without `refs/heads/`), a
 * pull request's branches on GitHub once it is loaded, or a followed branch and the remote's
 * default branch. `undefined` with no review, or for a pull request not loaded yet. Pure.
 */
export function branchesFrom({ session, pullRequest }: BranchFacts): ReviewBranches | undefined {
  if (session === undefined) {
    return undefined;
  }
  const { source } = session;
  switch (source.kind) {
    case 'local': {
      return { head: shortRefOf(source.headRef), base: shortRefOf(source.baseRef) };
    }
    case 'github-pull-request': {
      if (pullRequest === undefined) {
        return undefined;
      }
      return { head: pullRequest.headBranch, base: pullRequest.baseBranch };
    }
    case 'remote-branch': {
      const base = session.remoteBranch?.defaultBranch;
      if (base === undefined) {
        return { head: source.branch };
      }
      return { head: source.branch, base };
    }
  }
}

function shortRefOf(ref: string): string {
  const prefix = 'refs/heads/';
  if (ref.startsWith(prefix)) {
    return ref.slice(prefix.length);
  }
  return ref;
}
