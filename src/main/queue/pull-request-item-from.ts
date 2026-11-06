import type { AttentionView } from '#contract/ipc-contract.ts';
import { attentionFrom } from '#internal/github/attention-from.ts';

import type { EnrichedPull } from './enrich-pull-request.ts';
import type { QueueItemDraft } from './queue-item-draft.ts';
import type { SearchedEntry } from './search-host-pull-requests.ts';
import { waitingSinceFrom } from './waiting-since-from.ts';

/** A searched pull request and what was read about it. */
export interface PullRequestItemInput {
  readonly host: string;
  readonly key: string;
  readonly entry: SearchedEntry;
  readonly enriched: EnrichedPull;
  /** The signed-in login on that host, when known. */
  readonly viewer: string | undefined;
  /** The viewer's teams on that host as lowercase `org/slug`, when known. */
  readonly teams: ReadonlySet<string> | undefined;
}

/**
 * A pull request's queue row (ADR 0113). Attention is ADR 0066's, except that a team request
 * reads as the viewer's turn: search found it through `review-requested:@me`, so the viewer is on
 * the team. Without details yet, a review request is the viewer's turn and their own pull
 * request nobody's. It waits since {@link waitingSinceFrom} says. Pure.
 */
export function pullRequestItemFrom(input: PullRequestItemInput): QueueItemDraft {
  const { host, key, entry, enriched, viewer, teams } = input;
  const { pull } = entry;
  const details = enriched.details?.pullRequest;
  return {
    key,
    kind: 'pull-request',
    forge: 'github',
    host,
    owner: pull.owner,
    repo: pull.repo,
    number: pull.number,
    ...(details !== undefined && {
      branch: details.head.ref,
      baseBranch: details.base.ref,
      headSha: details.head.sha,
    }),
    ...(details?.size !== undefined && { size: details.size }),
    title: pull.title,
    author: pull.author,
    isDraft: pull.isDraft,
    htmlUrl: pull.htmlUrl,
    createdAt: pull.createdAt,
    updatedAt: pull.updatedAt,
    ...waitingSinceFrom({
      owner: pull.owner,
      author: pull.author,
      updatedAt: pull.updatedAt,
      request: entry.request,
      isAuthored: entry.reasons.includes('authored'),
      viewer,
      teams,
      requestEvents: enriched.requestEvents,
      reviews: enriched.details?.reviews,
    }),
    ...(enriched.ci !== undefined && { ci: enriched.ci }),
    attention: attentionOf(input),
    reasons: entry.reasons,
    ...(entry.request !== undefined && { request: entry.request }),
    ...(entry.isStale && { isStale: true }),
  };
}

function attentionOf({ entry, enriched, viewer }: PullRequestItemInput): AttentionView {
  const cached = enriched.details;
  if (cached === undefined) {
    if (entry.request !== undefined) {
      return { turn: 'you', reasons: ['a review was requested from you'] };
    }
    return { turn: 'unknown', reasons: ['GitHub has not said more yet'] };
  }
  const { pullRequest } = cached;
  const attention = attentionFrom({
    viewer,
    author: pullRequest.author,
    state: pullRequest.state,
    isDraft: pullRequest.isDraft,
    headSha: pullRequest.head.sha,
    requests: cached.requests,
    reviews: cached.reviews,
    ci: enriched.ci?.overall,
    ...(enriched.ci !== undefined && { failingChecks: enriched.ci.failing }),
  });
  if (attention.turn === 'reviewers' && entry.request === 'team') {
    return { turn: 'you', reasons: [...attention.reasons] };
  }
  return { turn: attention.turn, reasons: [...attention.reasons] };
}
