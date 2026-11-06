import type { RemoteBranchView } from '#contract/ipc-contract.ts';

/** The status bar's followed-branch segment (ADR 0112). */
export interface RemoteBranchLine {
  readonly tone: 'ok' | 'warn' | 'muted';
  readonly text: string;
  readonly title: string;
}

/**
 * `Following claude/fix`, `claude/fix is gone from GitHub`, or, when the branch's pull request is
 * reviewed in another session, `claude/fix · PR #7 has its own review`. The tooltip names the
 * repository, the default branch it is diffed against and that nothing is posted. Pure.
 */
export function describeRemoteBranch(branch: RemoteBranchView): RemoteBranchLine {
  const title = `${branch.owner}/${branch.repo}:${branch.branch} against ${branch.defaultBranch}. No pull request yet, so nothing is posted; export or copy the review instead.`;
  if (branch.state === 'gone') {
    return {
      tone: 'warn',
      text: `${branch.branch} is gone from GitHub`,
      title: `${title} The branch was deleted on GitHub; the review keeps its last head.`,
    };
  }
  if (branch.pullRequest?.sessionId !== undefined) {
    return {
      tone: 'muted',
      text: `${branch.branch} · PR #${String(branch.pullRequest.number)} has its own review`,
      title: `${title} Its pull request is open in another review session.`,
    };
  }
  return { tone: 'ok', text: `Following ${branch.branch}`, title };
}
