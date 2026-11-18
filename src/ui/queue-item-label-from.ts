import type { ReviewQueueItemView } from '#contract/ipc-contract.ts';

/**
 * A queue item's name while it opens (ADR 0145), as the titlebar names its session once it has:
 * `owner/repo#n Title` for a pull request, `owner/repo:branch` for a branch. Pure.
 */
export function queueItemLabelFrom(item: ReviewQueueItemView): string {
  const repository = `${item.owner}/${item.repo}`;
  if (item.kind === 'branch' && item.branch !== undefined) {
    return `${repository}:${item.branch}`;
  }
  if (item.number === undefined) {
    return `${repository} ${item.title}`;
  }
  return `${repository}#${String(item.number)} ${item.title}`;
}
