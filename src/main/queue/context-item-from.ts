import type { PullRequest } from '#internal/github/pull-request.ts';

import { pullRequestKeyOf } from './pull-request-key-of.ts';
import type { QueueItemDraft } from './queue-item-draft.ts';

/** An open pull request of a queued item's stack that is not itself queued. */
export interface ContextPull {
  readonly host: string;
  readonly owner: string;
  readonly repo: string;
  readonly pull: PullRequest;
}

/**
 * A stack's context row (ADR 0113 amendment): a pull request in the same stack as a queued one
 * that is not waiting on the viewer, with only what the open-pull-request list says (no size, CI
 * or attention). It waits since its last update and is nobody's turn as far as the queue knows.
 * Pure.
 */
export function contextItemFrom({ host, owner, repo, pull }: ContextPull): QueueItemDraft {
  return {
    key: pullRequestKeyOf(host, { owner, repo, number: pull.number }),
    kind: 'pull-request',
    forge: 'github',
    host,
    owner,
    repo,
    number: pull.number,
    branch: pull.head.ref,
    baseBranch: pull.base.ref,
    headSha: pull.head.sha,
    title: pull.title,
    author: pull.author,
    isDraft: pull.isDraft,
    htmlUrl: pull.htmlUrl,
    createdAt: pull.createdAt,
    updatedAt: pull.updatedAt,
    waitingSince: pull.updatedAt,
    waitingSinceSource: 'updated',
    attention: { turn: 'unknown', reasons: ['not waiting on you: in the stack of one that is'] },
    reasons: [],
    isContext: true,
  };
}
