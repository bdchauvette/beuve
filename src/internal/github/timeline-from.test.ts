import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import type {
  CommentTimelineEvent,
  CommitTimelineEvent,
  ReviewTimelineEvent,
} from './timeline-event.ts';
import { timelineFrom } from './timeline-from.ts';

function commit(at: string): CommitTimelineEvent {
  return { kind: 'commit', sha: 'a', headline: 'h', author: 'ann', at, url: 'u' };
}

function review(at: string): ReviewTimelineEvent {
  return { kind: 'review', verdict: 'approved', author: 'rita', body: '', at, url: 'u' };
}

function comment(at: string): CommentTimelineEvent {
  return { kind: 'comment', author: 'vic', body: 'hi', at, url: 'u' };
}

describe('timelineFrom', () => {
  test('puts every kind in one list, oldest first', ({ expect }) => {
    const events = timelineFrom({
      commits: [commit('2026-10-01T10:00:00Z'), commit('2026-10-03T10:00:00Z')],
      reviews: [review('2026-10-04T10:00:00Z')],
      comments: [comment('2026-10-02T10:00:00Z')],
    });
    expect(events.map((event) => event.kind)).toStrictEqual([
      'commit',
      'comment',
      'commit',
      'review',
    ]);
  });

  test('compares instants, not text, so offsets order correctly', ({ expect }) => {
    const events = timelineFrom({
      commits: [commit('2026-10-01T12:00:00+05:00')],
      reviews: [],
      comments: [comment('2026-10-01T08:00:00Z')],
    });
    // 12:00+05:00 is 07:00Z, before 08:00Z.
    expect(events.map((event) => event.kind)).toStrictEqual(['commit', 'comment']);
  });

  test('keeps commits, then reviews, then comments at the same instant', ({ expect }) => {
    const at = '2026-10-01T10:00:00Z';
    const events = timelineFrom({
      commits: [commit(at)],
      reviews: [review(at)],
      comments: [comment(at)],
    });
    expect(events.map((event) => event.kind)).toStrictEqual(['commit', 'review', 'comment']);
  });
});
