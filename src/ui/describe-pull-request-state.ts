import type { PullRequestBadgeView } from '#contract/ipc-contract.ts';

/** A pull request's state badge: `Draft` wins over `Open`. */
export interface PullRequestStateBadge {
  readonly label: 'Draft' | 'Open' | 'Merged' | 'Closed';
  readonly tone: 'muted' | 'ok' | 'merged' | 'danger';
}

/** Pure. */
export function describePullRequestState(
  pullRequest: Pick<PullRequestBadgeView, 'state' | 'isDraft'>,
): PullRequestStateBadge {
  switch (pullRequest.state) {
    case 'open': {
      if (pullRequest.isDraft) {
        return { label: 'Draft', tone: 'muted' };
      }
      return { label: 'Open', tone: 'ok' };
    }
    case 'merged': {
      return { label: 'Merged', tone: 'merged' };
    }
    case 'closed': {
      return { label: 'Closed', tone: 'danger' };
    }
  }
}
