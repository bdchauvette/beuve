import type { QueueLocalReviewView } from '#contract/ipc-contract.ts';

/** A queue row's local review badge: its words, its hover and how loud it is. */
export interface LocalReviewBadge {
  readonly text: string;
  readonly title: string;
  readonly tone: 'accent' | 'warn' | 'muted' | 'ok';
}

/**
 * How far beuve's own review of a queue item got (ADR 0113), as its badge: new commits since the
 * review stand out, a review in progress is noted, a finished one is quiet and an unopened one
 * says so. Pure.
 */
export function describeLocalReview(local: QueueLocalReviewView): LocalReviewBadge {
  const marked = local.markedFiles ?? 0;
  switch (local.state) {
    case 'none': {
      return { text: 'New', title: 'Not opened in beuve yet', tone: 'accent' };
    }
    case 'opened': {
      return {
        text: 'Opened',
        title: 'Opened in beuve; nothing marked reviewed yet',
        tone: 'muted',
      };
    }
    case 'partial': {
      let files = `${String(marked)} files`;
      if (marked === 1) {
        files = '1 file';
      }
      return {
        text: 'In progress',
        title: `${files} marked reviewed, no checkpoint yet`,
        tone: 'warn',
      };
    }
    case 'reviewed': {
      return { text: 'Reviewed', title: 'Reviewed up to the current head', tone: 'ok' };
    }
    case 'new-commits': {
      return {
        text: 'New commits',
        title: 'New commits since your last checkpoint: opening shows only what changed',
        tone: 'warn',
      };
    }
  }
}
