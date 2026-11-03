import type { TimelineEventView } from '#contract/ipc-contract.ts';

/** How the Overview's activity list words an event, and the colour of its dot. */
export interface TimelineEventLine {
  /** What the author did, after their name: `approved`, `pushed a commit`. */
  readonly verb: string;
  readonly tone: 'ok' | 'warn' | 'danger' | 'muted';
}

/** The verb and dot of one event of a pull request's history. Pure. */
export function describeTimelineEvent(event: TimelineEventView): TimelineEventLine {
  switch (event.kind) {
    case 'commit': {
      return { verb: 'pushed a commit', tone: 'muted' };
    }
    case 'comment': {
      return { verb: 'commented', tone: 'muted' };
    }
    case 'review': {
      switch (event.verdict) {
        case 'approved': {
          return { verb: 'approved', tone: 'ok' };
        }
        case 'changes-requested': {
          return { verb: 'requested changes', tone: 'danger' };
        }
        case 'dismissed': {
          return { verb: 'had a review dismissed', tone: 'warn' };
        }
        case 'commented': {
          return { verb: 'reviewed', tone: 'muted' };
        }
      }
    }
  }
}
