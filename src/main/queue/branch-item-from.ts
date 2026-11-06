import type { QueueCiView } from '#contract/ipc-contract.ts';

import { agentSessionUrlFrom } from '../github/agent-session-url-from.ts';

import { branchKeyOf } from './branch-key-of.ts';
import type { BranchCandidate } from './list-repository-branches.ts';
import type { QueueItemDraft } from './queue-item-draft.ts';

/** A branch without a pull request and its head's CI. */
export interface BranchItemInput {
  readonly candidate: BranchCandidate;
  readonly ci: QueueCiView | undefined;
}

/**
 * An agent branch's queue row (ADR 0113), from its comparison with the default branch: the head
 * commit's subject is the title, its author the author and its date the update; it waits since
 * the head was committed (ADR 0113 amendment); the first commit's date stands for when it was
 * created. It reads as the viewer's turn, and carries the
 * head commit's `Claude-Session` link when there is one. Pure.
 */
export function branchItemFrom({ candidate, ci }: BranchItemInput): QueueItemDraft {
  const { host, repository, tip, comparison } = candidate;
  const first = comparison.commits.at(0);
  const head = comparison.commits.at(-1);
  const updatedAt = head?.date ?? Temporal.Now.instant().toString();
  const agentSessionUrl = agentSessionUrlFrom(head?.message ?? '');
  return {
    key: branchKeyOf(host, { owner: repository.owner, repo: repository.repo, branch: tip.name }),
    kind: 'branch',
    forge: 'github',
    host,
    owner: repository.owner,
    repo: repository.repo,
    branch: tip.name,
    baseBranch: repository.defaultBranch,
    headSha: tip.sha,
    size: comparison.size,
    title: subjectOf(head?.message ?? '') || tip.name,
    author: head?.author ?? 'ghost',
    isDraft: false,
    htmlUrl: `${repository.htmlUrl}/tree/${tip.name}`,
    createdAt: first?.date ?? updatedAt,
    updatedAt,
    waitingSince: head?.committedAt ?? updatedAt,
    waitingSinceSource: 'pushed',
    ...(ci !== undefined && { ci }),
    attention: { turn: 'you', reasons: ['an agent branch has no pull request yet'] },
    reasons: ['branch'],
    ...(agentSessionUrl !== undefined && { agentSessionUrl }),
    ...(candidate.isStale && { isStale: true }),
  };
}

/** A commit message's first line. */
function subjectOf(message: string): string {
  return (message.split('\n', 1)[0] ?? '').trim();
}
