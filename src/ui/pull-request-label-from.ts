import type { RemoteBranchView } from '#contract/ipc-contract.ts';
import { revealFormatControls } from '#x/text/reveal-format-controls.ts';

/**
 * A followed branch's pull request as the UI names it: `#7` in the branch's own repository,
 * `owner/repo#7` in an upstream of its fork (ADR 0112), the name through `revealFormatControls`.
 */
export function pullRequestLabelFrom(
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
