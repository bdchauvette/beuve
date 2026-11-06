import type { ReviewQueueItemView } from '#contract/ipc-contract.ts';
import type { ReviewRequestEvent } from '#internal/github/list-review-request-events.ts';
import type { PullRequestReview } from '#internal/github/pull-request-review.ts';

/** What tells when a pull request started waiting on the viewer. */
export interface WaitingInput {
  /** The repository owner: the organization a requested team belongs to. */
  readonly owner: string;
  readonly author: string;
  readonly updatedAt: string;
  /** How the review was requested of the viewer, if it was. */
  readonly request: 'direct' | 'team' | undefined;
  /** It is the viewer's own pull request. */
  readonly isAuthored: boolean;
  readonly viewer: string | undefined;
  /** The viewer's teams as lowercase `org/slug`; `undefined` when they could not be read. */
  readonly teams: ReadonlySet<string> | undefined;
  /** The pull request's review requests, oldest first; `undefined` when unread. */
  readonly requestEvents: readonly ReviewRequestEvent[] | undefined;
  readonly reviews: readonly PullRequestReview[] | undefined;
}

/** When an item started waiting, and what that time is. */
export type WaitingSince = Pick<ReviewQueueItemView, 'waitingSince' | 'waitingSinceSource'>;

/**
 * When a pull request started waiting on the viewer (ADR 0113 amendment). A requested review
 * waits since the latest request of the viewer by name or of a team they are on (a re-request
 * after a push resets it); for a team request whose team can't be told (teams unreadable, or a
 * parent team), since the latest request of the viewer or of any team. The viewer's own pull request waits since
 * someone else last requested changes. Otherwise, or when the events are missing, since its last
 * activity (`updated_at`). Pure.
 */
export function waitingSinceFrom(input: WaitingInput): WaitingSince {
  const requested = requestedAt(input);
  if (requested !== undefined) {
    return { waitingSince: requested, waitingSinceSource: 'requested' };
  }
  if (input.isAuthored) {
    const changes = latest(
      (input.reviews ?? [])
        .filter((review) => {
          return (
            review.verdict === 'changes-requested' &&
            review.reviewer.toLowerCase() !== input.author.toLowerCase()
          );
        })
        .map((review) => review.submittedAt),
    );
    if (changes !== undefined) {
      return { waitingSince: changes, waitingSinceSource: 'changes-requested' };
    }
  }
  return { waitingSince: input.updatedAt, waitingSinceSource: 'updated' };
}

/** The latest request of the viewer, by name or through a team; `undefined` when none is known. */
function requestedAt(input: WaitingInput): string | undefined {
  const { request, requestEvents, viewer, teams, owner } = input;
  if (request === undefined || requestEvents === undefined) {
    return undefined;
  }
  const login = viewer?.toLowerCase();
  const mine = requestEvents.filter((event) => {
    if (event.reviewer !== undefined) {
      return event.reviewer.toLowerCase() === login;
    }
    return event.team !== undefined && teams?.has(`${owner}/${event.team}`.toLowerCase()) === true;
  });
  const own = latest(mine.map((event) => event.at));
  if (request === 'direct' || (own !== undefined && teams !== undefined)) {
    return own;
  }
  const teamRequests = requestEvents.filter((event) => event.team !== undefined);
  return latest([...mine, ...teamRequests].map((event) => event.at));
}

/** The latest of some ISO instants. */
function latest(instants: readonly string[]): string | undefined {
  let found: string | undefined;
  for (const instant of instants) {
    if (
      found === undefined ||
      Temporal.Instant.compare(Temporal.Instant.from(instant), Temporal.Instant.from(found)) > 0
    ) {
      found = instant;
    }
  }
  return found;
}
