import type {
  CommentTimelineEvent,
  CommitTimelineEvent,
  ReviewTimelineEvent,
  TimelineEvent,
} from './timeline-event.ts';

/** What a timeline is made of, each list in the order GitHub gave it. */
export interface TimelineParts {
  readonly commits: readonly CommitTimelineEvent[];
  readonly reviews: readonly ReviewTimelineEvent[];
  readonly comments: readonly CommentTimelineEvent[];
}

/**
 * The events of every kind in one list, oldest first. Events at the same instant keep their kind's
 * order: commits, then reviews, then comments, each as GitHub listed them. Pure.
 */
export function timelineFrom(parts: TimelineParts): TimelineEvent[] {
  const events: TimelineEvent[] = [...parts.commits, ...parts.reviews, ...parts.comments];
  return events.toSorted((a, b) => {
    return Temporal.Instant.compare(Temporal.Instant.from(a.at), Temporal.Instant.from(b.at));
  });
}
