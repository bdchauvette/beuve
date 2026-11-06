import type { RemoteBranchView } from '#contract/ipc-contract.ts';
import { revealFormatControls } from '#x/text/reveal-format-controls.ts';

/** The status bar's followed-branch segment (ADR 0112). */
export interface RemoteBranchLine {
  readonly tone: 'ok' | 'warn' | 'muted';
  readonly text: string;
  readonly title: string;
}

/**
 * `Following claude/fix`, `claude/fix is gone from GitHub`, or, when the branch's pull request is
 * reviewed in another session, `claude/fix · PR #7 has its own review`. A pull request from a
 * fork into an upstream the clone has no remote for reads `claude/fix · PR up/repo#7 is open; add
 * a remote for up/repo to review it as a pull request`. Names go through `revealFormatControls`
 * (ADR 0082). The tooltip names the repository, the default branch it is diffed against and that
 * nothing is posted. Pure.
 */
export function describeRemoteBranch(branch: RemoteBranchView): RemoteBranchLine {
  const name = revealFormatControls(branch.branch);
  const title = `${revealFormatControls(`${branch.owner}/${branch.repo}:${branch.branch}`)} against ${revealFormatControls(branch.defaultBranch)}. No pull request yet, so nothing is posted; export or copy the review instead.`;
  if (branch.state === 'gone') {
    return {
      tone: 'warn',
      text: `${name} is gone from GitHub`,
      title: `${title} The branch was deleted on GitHub; the review keeps its last head.`,
    };
  }
  const { pullRequest } = branch;
  if (pullRequest?.sessionId !== undefined) {
    return {
      tone: 'muted',
      text: `${name} · PR ${pullRequestName(branch, pullRequest)} has its own review`,
      title: `${title} Its pull request is open in another review session.`,
    };
  }
  if (pullRequest?.needsRemote === true) {
    const repository = revealFormatControls(`${pullRequest.owner}/${pullRequest.repo}`);
    return {
      tone: 'warn',
      text: `${name} · PR ${pullRequestName(branch, pullRequest)} is open; add a remote for ${repository} to review it as a pull request`,
      title: `${title} beuve never changes the clone's remotes; once one names ${repository}, this review continues as the pull request.`,
    };
  }
  return { tone: 'ok', text: `Following ${name}`, title };
}

/** `#7` in the branch's own repository, `owner/repo#7` in an upstream of its fork. */
function pullRequestName(
  branch: RemoteBranchView,
  pullRequest: NonNullable<RemoteBranchView['pullRequest']>,
): string {
  const number = `#${String(pullRequest.number)}`;
  const isOwn =
    pullRequest.owner.toLowerCase() === branch.owner.toLowerCase() &&
    pullRequest.repo.toLowerCase() === branch.repo.toLowerCase();
  if (isOwn) {
    return number;
  }
  return `${revealFormatControls(`${pullRequest.owner}/${pullRequest.repo}`)}${number}`;
}
